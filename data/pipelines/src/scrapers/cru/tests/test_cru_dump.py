"""The dump pipeline and the pg_dump invocation it builds.

`subprocess.Popen` and `psycopg.connect` are replaced throughout, so these run
with the network down. Several tests replace them with something that *raises*,
which turns "did this accidentally reach for the database?" into a failure
rather than a hang in CI.
"""

import gzip
import subprocess
from pathlib import Path

import pytest

from scrapers.cru import config, mirror
from scrapers.cru import dump as dump_module
from scrapers.cru.artifact import sha256_of
from scrapers.cru.dump import CruDump
from scrapers.cru.mirror import CruDumpError, assert_no_password, dump_to

SCHEMA_PASS = [
    b"--\n",
    b"-- PostgreSQL database dump\n",
    b"\\restrict abcdefTHENONCE\n",
    b"CREATE TABLE public.umowa (id_umowy uuid);\n",
    b"\\unrestrict abcdefTHENONCE\n",
]
DATA_PASS = [
    b"COPY public.umowa (id_umowy) FROM stdin;\n",
    b"aaaa\n",
    b"\\.\n",
]


class FakeProcess:
    """Just enough of Popen for `_run_pass`."""

    def __init__(self, lines: list[bytes], returncode: int = 0) -> None:
        self.stdout = _Lines(lines)
        self._returncode = returncode
        self.killed = False

    def wait(self, timeout: int | None = None) -> int:
        return self._returncode

    def kill(self) -> None:
        self.killed = True


class _Lines:
    def __init__(self, lines: list[bytes]) -> None:
        self._lines = lines

    def __iter__(self):
        return iter(self._lines)

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@pytest.fixture
def recorded_argv(monkeypatch) -> list[list[str]]:
    """Capture every pg_dump argv, and serve canned output for each pass."""
    calls: list[list[str]] = []
    passes = [SCHEMA_PASS, DATA_PASS]

    def fake_popen(argv, stdout=None, stderr=None):
        calls.append(argv)
        return FakeProcess(passes[len(calls) - 1])

    monkeypatch.setattr(subprocess, "Popen", fake_popen)
    monkeypatch.setattr(
        mirror, "preflight", lambda dsn: ("PostgreSQL 15.10 (Debian)", 301347)
    )
    monkeypatch.setattr(mirror, "pg_dump_version", lambda: "16.14")
    return calls


def test_the_two_passes_carry_the_flags_the_read_only_role_needs(
    tmp_path: Path, recorded_argv
) -> None:
    dump_to(tmp_path / "out.sql.gz", config.DEFAULT_DSN, timeout=60)

    schema, data = recorded_argv
    assert "--schema-only" in schema
    assert "--data-only" in data
    # Without this the data pass aborts: a data dump reads last_value from
    # every sequence, and the role cannot SELECT this one.
    assert "--exclude-table-data=*strona_umowy_id_seq" in data
    # Without -w a headless run blocks forever on a password prompt.
    assert "-w" in schema and "-w" in data


def test_no_password_ever_reaches_the_command_line(
    tmp_path: Path, recorded_argv
) -> None:
    """argv is world-readable through `ps`."""
    dump_to(tmp_path / "out.sql.gz", config.DEFAULT_DSN, timeout=60)
    for argv in recorded_argv:
        assert not any("password" in arg.lower() for arg in argv)
        assert all(":" not in arg.split("//")[-1].split("@")[0] for arg in argv)


def test_the_restrict_nonce_lines_are_stripped(tmp_path: Path, recorded_argv) -> None:
    """They carry a random nonce and psql below 16 rejects them outright."""
    destination = tmp_path / "out.sql.gz"
    dump_to(destination, config.DEFAULT_DSN, timeout=60)

    with gzip.open(destination, "rt", encoding="utf-8") as handle:
        text = handle.read()
    assert "\\restrict" not in text
    assert "\\unrestrict" not in text
    assert "CREATE TABLE public.umowa" in text


def test_the_sequence_repair_is_appended(tmp_path: Path, recorded_argv) -> None:
    destination = tmp_path / "out.sql.gz"
    info = dump_to(destination, config.DEFAULT_DSN, timeout=60)

    with gzip.open(destination, "rt", encoding="utf-8") as handle:
        text = handle.read()
    assert "setval('public.strona_umowy_id_seq', 301347, true)" in text
    assert info.strona_umowy_max_id == 301347
    assert info.server_version.startswith("PostgreSQL 15.10")


def test_a_failed_pass_raises_with_the_stderr_attached(
    tmp_path: Path, monkeypatch
) -> None:
    """The stderr text is the only thing that says *why* pg_dump failed."""

    def failing_popen(argv, stdout=None, stderr=None):
        stderr.write(b"pg_dump: error: permission denied for sequence\n")
        return FakeProcess([], returncode=1)

    monkeypatch.setattr(subprocess, "Popen", failing_popen)
    monkeypatch.setattr(mirror, "preflight", lambda dsn: ("15.10", 1))

    with pytest.raises(CruDumpError, match="permission denied for sequence"):
        dump_to(tmp_path / "out.sql.gz", config.DEFAULT_DSN, timeout=60)


def test_a_dsn_carrying_a_password_is_refused() -> None:
    """The DSN is recorded in the manifest and uploaded to the shared cache."""
    with pytest.raises(ValueError, match="pgpass"):
        assert_no_password("postgresql://user:hunter2@host:5432/db")


def test_the_default_dsn_carries_no_password() -> None:
    assert_no_password(config.DEFAULT_DSN)


def test_the_manifest_and_the_artifact_use_different_shared_cache_keys() -> None:
    """`download_backup` returns the last blob under `filename=<name>/`.

    A 45 MB artifact and a 500-byte manifest under one key would mean each
    reader gets whichever happened to sort higher.
    """
    assert CruDump.filename != config.ARTIFACT_NAME


def test_the_manifest_output_path_is_the_usual_shape() -> None:
    assert CruDump().output_path() == "cru_dump/cru_dump.jsonl"


def test_the_dump_pipeline_has_no_pipeline_dependencies() -> None:
    """It is the root: everything it needs comes from the mirror."""
    assert dict(CruDump().list_sources()) == {}


def _publishing_pipeline(
    sample_dump: Path, monkeypatch, source: str, previous: str | None
):
    """A CruDump wired to `sample_dump`, recording whether it published."""
    pipeline = CruDump()
    published: list[Path] = []
    monkeypatch.setattr(dump_module, "artifact_path", lambda name=None: sample_dump)
    monkeypatch.setattr(dump_module, "backup_disabled", lambda: False)
    monkeypatch.setattr(pipeline, "_acquire", lambda ctx, flags, final: (source, None))
    monkeypatch.setattr(pipeline, "_previous_sha", lambda ctx: previous)
    monkeypatch.setattr(
        pipeline, "_publish", lambda ctx, final: published.append(final)
    )
    return pipeline, published


def test_an_unchanged_artifact_is_not_published_again(
    sample_dump: Path, monkeypatch
) -> None:
    """The bucket partitions by timestamp and nothing ever prunes it.

    Without this guard every run would add another copy of a 45 MB artifact
    that is byte-identical to the one already there.
    """
    pipeline, published = _publishing_pipeline(
        sample_dump, monkeypatch, source="pg_dump", previous=sha256_of(sample_dump)
    )
    pipeline.process(object())  # type: ignore[arg-type]
    assert published == []


def test_a_changed_artifact_is_published(sample_dump: Path, monkeypatch) -> None:
    pipeline, published = _publishing_pipeline(
        sample_dump, monkeypatch, source="pg_dump", previous="a-different-sha"
    )
    pipeline.process(object())  # type: ignore[arg-type]
    assert published == [sample_dump]


@pytest.mark.parametrize("source", ["local-cache", "shared-cache", "file"])
def test_only_a_freshly_dumped_artifact_is_published(
    sample_dump: Path, monkeypatch, source: str
) -> None:
    """Re-uploading what we just downloaded would be pure waste."""
    pipeline, published = _publishing_pipeline(
        sample_dump, monkeypatch, source=source, previous=None
    )
    pipeline.process(object())  # type: ignore[arg-type]
    assert published == []
