"""CruUmowy -- the contracts, as one JSONL line each.

Reads only the artifact `CruDump` produced, never the database. That is the
whole point of splitting the two: acquiring the data needs a password and a
postgres client, but *using* it needs neither, so anyone who can reach the
shared cache can rebuild this output byte for byte from the same artifact.

`IncrementalJsonlPipeline` rather than `Pipeline`, because the base class
writes its output by handing `process()`'s DataFrame to pandas -- which would
mean holding all 149683 contracts, with their parties, in memory at once. The
incremental base streams records through the dumper into a `.tmp` and renames
it into place at the end instead.
"""

import typing
from pathlib import Path

import pandas as pd

from entities.cru import CruUmowa
from scrapers.article.pipelines.incremental import IncrementalJsonlPipeline
from scrapers.cru import config
from scrapers.cru.artifact import artifact_path, write_atomically
from scrapers.cru.dump import CruArtifactUnavailable, CruDump
from scrapers.cru.records import build_index, iter_records
from scrapers.stores import Context, backup_disabled
from scrapers.stores.file import VersionedBackup


class CruUmowy(IncrementalJsonlPipeline[CruUmowa]):
    """One record per CRU contract, with its parties nested."""

    filename = "cru_umowy"

    # ~300 MB. Large derived output stays local, same as the article
    # pipelines: the artifact it is derived from is already in the shared
    # cache, and re-deriving costs seconds.
    backup_to_shared_cache = False

    interrupt_exceptions = (InterruptedError,)

    # The dependency, declared the way the framework reads it: a bare class
    # annotation. `from __future__ import annotations` must never be added to
    # this module -- `_annotated_classes` keeps only entries where the
    # annotation is already a class, so PEP 563 would turn this into the
    # string "CruDump" and silently drop the dependency with no error.
    dump: CruDump

    # Identifiers with significant leading zeros. Without this, reading the
    # output back turns REGON "000524832" into the integer 524832.
    dtype = {
        "id_umowy": str,
        "zrodlo": str,
        "numer_umowy": str,
        "okres": str,
        "zamawiajacy_nazwa": str,
        "zamawiajacy_nip": str,
        "zamawiajacy_regon": str,
        "zamawiajacy_regon9": str,
        "data_zawarcia_umowy": str,
        "data_zakonczenia_umowy": str,
        "data_publikacji": str,
        "data_modyfikacji": str,
        "zaimportowano": str,
    }

    @property
    def output_class(self):
        return CruUmowa

    def process(self, ctx: Context) -> pd.DataFrame:
        manifest = self.dump.read_or_process(ctx).iloc[0]
        path = self._artifact(ctx, manifest)

        self.prepare_temp_output()
        index = build_index(path)
        print(f"CRU: indexed {sum(len(v) for v in index.lines.values())} stron")

        written = 0
        for record in iter_records(path, index):
            ctx.io.output_entity(record)
            written += 1

        # Anything left is a party whose contract is not in the dump, which
        # means the artifact is inconsistent -- better to fail than to publish
        # an output that quietly lost parties.
        assert not index.lines, (
            f"{len(index.lines)} contracts had parties but no umowa row; "
            f"the artifact at {path} is inconsistent"
        )

        # A cache hit prints nothing at all, so an explicit count is the only
        # way to tell "wrote the file" from "decided not to".
        print(f"CruUmowy: wrote {written} records")

        # The real output went through the dumper into the .tmp file, which
        # the base class renames into place. Returning rows here would make
        # pandas write the whole thing a second time.
        return pd.DataFrame()

    def _artifact(self, ctx: Context, manifest: typing.Any) -> Path:
        """The artifact named by the manifest, fetched if we do not have it.

        Never contacts postgres: acquiring new data is `CruDump`'s job, and a
        machine running only this pipeline may have no credentials at all.
        """
        path = artifact_path(str(manifest["artifact_filename"]))
        expected = int(manifest["bytes"])

        if path.exists() and path.stat().st_size == expected:
            return path

        if path.exists():
            print(
                f"CRU: {path} is {path.stat().st_size} bytes, manifest says "
                f"{expected} -- refetching"
            )

        if backup_disabled():
            raise CruArtifactUnavailable(
                f"{path} is missing or the wrong size, and the shared cache is "
                f"switched off by --no-backup / DISABLE_BACKUP. Run CruDump, "
                f"or pass --cru-dump-file <path>."
            )

        print(f"CRU: fetching {config.ARTIFACT_NAME} from the shared cache")
        data = ctx.io.read_data(VersionedBackup(config.ARTIFACT_NAME)).read_bytes()
        write_atomically(path, [data])
        return path
