"""Producing the dump artifact from the CRU postgres mirror.

Two `pg_dump` passes rather than one, because the role we connect with is
read-only in a way that defeats a plain dump: it cannot `SELECT` the
`strona_umowy_id_seq` sequence, and a data dump reads `last_value` from every
sequence it carries. `--exclude-table-data` drops that read while keeping the
sequence's definition, which the schema pass emits. The sequence's position is
then restored from `max(strona_umowy.id)` -- a lower bound if rows were ever
deleted, but the column is `GENERATED ALWAYS AS IDENTITY`, so the only
consequence is reusing ids that no longer exist.

Nothing here knows a password. `pg_dump -w` and `psycopg.connect` both resolve
one from `~/.pgpass`; `-w` is load-bearing, because without it a headless run
blocks forever on a password prompt instead of failing.
"""

import gzip
import subprocess
import typing
from dataclasses import dataclass
from pathlib import Path

import psycopg

_BASE = ["pg_dump", "--no-owner", "--no-privileges", "-w"]

#: The read-only role cannot read this sequence. Excluding its *data* keeps the
#: `CREATE`/`ALTER ... IDENTITY` from the schema pass and drops the `SELECT
#: last_value` that would abort the data pass.
_DATA_ONLY = ["--data-only", "--exclude-table-data=*strona_umowy_id_seq"]

#: `\restrict`/`\unrestrict` wrap dumps from pg_dump 16.10+ and carry a random
#: per-invocation nonce. psql below 16 rejects them outright, so stripping them
#: is what makes the artifact loadable by an older client. Two lines per pass.
_DROP_PREFIXES = (b"\\restrict ", b"\\unrestrict ")


class CruDumpError(RuntimeError):
    """pg_dump failed, with its stderr attached."""


@dataclass(frozen=True)
class MirrorInfo:
    """What the mirror said about itself while we dumped it."""

    server_version: str
    pg_dump_version: str | None
    strona_umowy_max_id: int


def assert_no_password(dsn: str) -> None:
    """Refuse a conninfo that carries a password.

    The DSN is recorded in the manifest, which is uploaded to the shared cache
    and committed to nobody's secret store. A password belongs in ~/.pgpass.
    """
    _, _, rest = dsn.partition("//")
    userinfo, at, _ = rest.partition("@")
    if at and ":" in userinfo:
        raise ValueError(
            "The CRU DSN carries a password. Put it in ~/.pgpass instead -- "
            "the DSN is recorded in the manifest and uploaded to the shared cache."
        )


def pg_dump_version() -> str | None:
    """`pg_dump --version`, or None when the binary is missing.

    Worth recording: pg_dump refuses to dump from a server newer than itself,
    so a version mismatch is the first thing to check when a dump that used to
    work stops.
    """
    try:
        done = subprocess.run(
            ["pg_dump", "--version"],
            capture_output=True,
            text=True,
            timeout=30,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if done.returncode != 0:
        return None
    return done.stdout.strip().removeprefix("pg_dump (PostgreSQL) ")


def preflight(dsn: str) -> tuple[str, int]:
    """Check the mirror answers, and read what the dump cannot.

    Returns the server version and `max(strona_umowy.id)`. Doing this before
    spawning pg_dump turns an unreachable mirror into a fast, clear failure
    rather than a subprocess that dies halfway through writing an artifact.
    """
    assert_no_password(dsn)
    with psycopg.connect(dsn) as conn:
        version = conn.execute("select version()").fetchone()
        max_id = conn.execute(
            "select coalesce(max(id), 0) from public.strona_umowy"
        ).fetchone()
    assert version is not None and max_id is not None
    return str(version[0]), int(max_id[0])


class ByteSink(typing.Protocol):
    """Anything the dump can be streamed into. `_run_pass` only ever writes."""

    def write(self, data: bytes, /) -> object: ...


def _run_pass(argv: list[str], sink: ByteSink, stderr_path: Path, timeout: int) -> None:
    """Stream one pg_dump pass into `sink`, dropping the psql-16-only lines.

    stderr goes to a *file*, not a pipe: draining stdout while stderr fills its
    64 KB pipe buffer deadlocks, and `tempfile` is not importable from this
    layer.
    """
    with stderr_path.open("wb") as stderr:
        process = subprocess.Popen(argv, stdout=subprocess.PIPE, stderr=stderr)
        assert process.stdout is not None
        try:
            with process.stdout as out:
                for line in out:
                    if not line.startswith(_DROP_PREFIXES):
                        sink.write(line)
            returncode = process.wait(timeout=timeout)
        except BaseException:
            process.kill()
            process.wait()
            raise

    if returncode != 0:
        detail = stderr_path.read_text("utf-8", "replace").strip()
        raise CruDumpError(f"pg_dump exited {returncode}: {detail}")


def dump_to(destination: Path, dsn: str, timeout: int) -> MirrorInfo:
    """Write a gzipped schema+data dump of the mirror to `destination`."""
    server_version, max_id = preflight(dsn)
    stderr_path = destination.with_name(destination.name + ".err")
    try:
        with gzip.open(destination, "wb", compresslevel=6) as sink:
            _run_pass(_BASE + ["--schema-only", dsn], sink, stderr_path, timeout)
            _run_pass(_BASE + _DATA_ONLY + [dsn], sink, stderr_path, timeout)
            sink.write(_setval(max_id))
    finally:
        stderr_path.unlink(missing_ok=True)

    return MirrorInfo(
        server_version=server_version,
        pg_dump_version=pg_dump_version(),
        strona_umowy_max_id=max_id,
    )


def _setval(max_id: int) -> bytes:
    return (
        b"\n--\n"
        b"-- Sequence value repaired from max(strona_umowy.id): the read-only\n"
        b"-- role lacks SELECT on strona_umowy_id_seq, so its true last_value\n"
        b"-- was not readable. The column is GENERATED ALWAYS AS IDENTITY, so\n"
        b"-- the only cost of a low value is reusing ids that no longer exist.\n"
        b"--\n"
        b"SELECT pg_catalog.setval('public.strona_umowy_id_seq', "
        + str(max_id).encode()
        + b", true);\n"
    )
