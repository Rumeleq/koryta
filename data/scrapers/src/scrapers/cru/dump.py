"""CruDump -- fetch the CRU mirror as a compressed dump, and describe it.

The pipeline framework can only carry `jsonl` or `csv` as a pipeline output, so
a 45 MB `.sql.gz` cannot itself be one. The artifact is therefore a side effect
written to the shared `downloaded/` cache, and the *output* is a one-row
manifest describing it. That split is what the rest of the system needs anyway:
`ProcessPolicy` stats the manifest to decide freshness, and `CruUmowy` checks
the artifact against the manifest's size before reading it.

Acquisition is a ladder, tried in order, so the pipeline works on three quite
different machines:

1. `--cru-dump-file` -- adopt an artifact the caller already has.
2. `pg_dump` against the mirror. Needs `postgresql-client` and a `~/.pgpass`
   line; this is the only rung that produces new data.
3. `downloaded/` -- whatever a previous run on this machine left.
4. the GCS shared cache -- what makes a checkout with no database password
   able to run `CruUmowy` at all.
"""

import dataclasses
import subprocess
import typing
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import psycopg

from entities.cru import CruDumpManifest
from scrapers.cru import config
from scrapers.cru.artifact import artifact_path, sha256_of, write_atomically
from scrapers.cru.mirror import CruDumpError, dump_to, pg_dump_version
from scrapers.cru.records import scan_artifact
from scrapers.stores import Context, Pipeline, backup_disabled
from scrapers.stores.file import VersionedBackup


class CruArtifactUnavailable(RuntimeError):
    """Every rung of the acquisition ladder failed."""


class CruDump(Pipeline[CruDumpManifest]):
    """The CRU postgres mirror, dumped and published to the shared cache."""

    # Deliberately not `config.ARTIFACT_NAME`: the manifest and the artifact
    # are two objects in the same bucket, and `download_backup` returns the
    # last blob under `filename=<name>/`. Sharing a key would hand a reader
    # whichever of the two happened to sort higher.
    filename = "cru_dump"

    # ~500 bytes, and it is what a passwordless checkout reads first to find
    # out which artifact it should be pulling.
    backup_to_shared_cache = True

    # Identifiers and dates stay strings. Without this pandas reads `sha256`
    # as a float when it happens to be all digits, and dates as Timestamps.
    dtype = {
        "artifact_name": str,
        "artifact_filename": str,
        "sha256": str,
        "source": str,
        "dumped_utc": str,
        "dsn": str,
        "server_version": str,
        "pg_dump_version": str,
        "max_data_publikacji": str,
    }

    @property
    def output_class(self):
        return CruDumpManifest

    def process(self, ctx: Context) -> pd.DataFrame:
        flags = config.args()
        final = artifact_path()
        previous_sha = self._previous_sha(ctx)

        source, info = self._acquire(ctx, flags, final)
        print(f"CRU: artifact from {source} at {final}")

        manifest = scan_artifact(
            final,
            artifact_name=config.ARTIFACT_NAME,
            artifact_filename=config.ARTIFACT_FILENAME,
            sha256=sha256_of(final),
            size=final.stat().st_size,
            source=source,
            dsn=flags.cru_dsn,
            dumped_utc=datetime.now(timezone.utc).isoformat(timespec="seconds"),
            server_version=info[0] if info else None,
            pg_dump_version=info[1] if info else pg_dump_version(),
        )
        print(
            f"CRU: {manifest.rows_umowa} umowy, "
            f"{manifest.rows_strona_umowy} stron, "
            f"{manifest.rows_wynik_wyszukiwania} w indeksie "
            f"({manifest.rows_detale_niedostepne} bez detali), "
            f"do {manifest.max_data_publikacji}"
        )

        # Only publish something we just made, and only when it differs from
        # what we published last time: the bucket partitions by datetime and
        # nothing in this repo ever prunes it, so an unguarded upload would add
        # 45 MB per run forever.
        if (
            source == "pg_dump"
            and not flags.cru_no_publish
            and not backup_disabled()
            and manifest.sha256 != previous_sha
        ):
            self._publish(ctx, final)

        return pd.DataFrame.from_records([dataclasses.asdict(manifest)])

    def _acquire(
        self, ctx: Context, flags: typing.Any, final: Path
    ) -> tuple[str, tuple[str, str | None] | None]:
        """Get the artifact to `final`, returning how, and what the mirror said."""
        if flags.cru_dump_file:
            given = Path(flags.cru_dump_file)
            if given.resolve() != final.resolve():
                write_atomically(final, _chunks(given))
            return "file", None

        if not flags.cru_no_redump:
            try:
                info = self._redump(flags, final)
                return "pg_dump", (info.server_version, info.pg_dump_version)
            except (
                OSError,
                psycopg.Error,
                CruDumpError,
                subprocess.SubprocessError,
            ) as error:
                # A missing pg_dump surfaces here as a bare FileNotFoundError,
                # which says nothing on its own -- name the cause.
                print(f"CRU: could not dump the mirror ({error!r}); falling back")

        if final.exists():
            return "local-cache", None

        if not backup_disabled():
            print(f"CRU: restoring {config.ARTIFACT_NAME} from the shared cache")
            data = ctx.io.read_data(VersionedBackup(config.ARTIFACT_NAME)).read_bytes()
            write_atomically(final, [data])
            return "shared-cache", None

        raise CruArtifactUnavailable(
            f"No CRU dump available. Tried {flags.cru_dsn} (needs a "
            f"postgresql-client at least as new as the server, and a ~/.pgpass "
            f"line host:5432:rejestr_umow:koryta_ro_user:<password>), "
            f"{final}, and the shared cache -- which --no-backup / "
            f"DISABLE_BACKUP has switched off. Pass --cru-dump-file <path> to "
            f"use an artifact you already have."
        )

    def _redump(self, flags: typing.Any, final: Path):
        """Dump to a staging file, then swap it in only once it is complete."""
        part = final.with_name(f"{final.name}.part")
        part.parent.mkdir(parents=True, exist_ok=True)
        try:
            info = dump_to(part, flags.cru_dsn, flags.cru_dump_timeout)
            part.replace(final)
            return info
        except BaseException:
            part.unlink(missing_ok=True)
            raise

    def _publish(self, ctx: Context, final: Path) -> None:
        def writer(handle: typing.Any) -> None:
            for chunk in _chunks(final):
                handle.write(chunk)

        ctx.io.write_file(VersionedBackup(config.ARTIFACT_NAME), writer)

    def _previous_sha(self, ctx: Context) -> str | None:
        """The sha of the artifact this pipeline last published, if any."""
        try:
            df = self.read(ctx)
        except Exception:
            return None
        if df is None or df.empty:
            return None
        return str(df.iloc[0]["sha256"])


def _chunks(path: Path, size: int = 1 << 20) -> typing.Iterator[bytes]:
    with path.open("rb") as handle:
        while chunk := handle.read(size):
            yield chunk
