"""The JSONL pipeline: its wiring, and one full run against the fixture."""

import dataclasses
import json
import subprocess
from pathlib import Path
from unittest.mock import MagicMock

import pandas as pd
import pytest

from entities.cru import CruUmowa
from scrapers.cru import umowy as umowy_module
from scrapers.cru.dump import CruDump
from scrapers.cru.umowy import CruUmowy
from scrapers.stores import iterate_pipeline


@pytest.fixture
def wired(sample_dump: Path, monkeypatch) -> tuple[CruUmowy, MagicMock, list[CruUmowa]]:
    """A CruUmowy whose dependency is already satisfied by the fixture dump.

    `subprocess.Popen` is made to raise: this pipeline must never reach for
    the database, and a silent fallback to dumping would otherwise only show
    up as a hang on a machine with no credentials.
    """

    def no_subprocesses(*args, **kwargs):
        raise AssertionError("CruUmowy must not shell out to the database")

    monkeypatch.setattr(subprocess, "Popen", no_subprocesses)
    monkeypatch.setattr(umowy_module, "artifact_path", lambda name=None: sample_dump)

    pipeline = CruUmowy()
    manifest = pd.DataFrame.from_records(
        [
            {
                "artifact_filename": sample_dump.name,
                "bytes": sample_dump.stat().st_size,
            }
        ]
    )
    monkeypatch.setattr(pipeline.dump, "read_or_process", lambda ctx: manifest)

    written: list[CruUmowa] = []
    # Not spec=Context: Context is a dataclass, so its fields are instance
    # attributes and a spec'd mock rejects `ctx.io` outright.
    ctx = MagicMock()
    ctx.io.output_entity.side_effect = lambda entity, *a, **k: written.append(entity)
    return pipeline, ctx, written


def test_the_dump_is_declared_as_a_pipeline_dependency() -> None:
    """Guards against `from __future__ import annotations` in umowy.py.

    `_annotated_classes` keeps only annotations that are already classes, so
    PEP 563 would turn `dump: CruDump` into the string "CruDump" and drop the
    dependency silently -- the pipeline would then run against whatever stale
    artifact happened to be on disk.
    """
    assert dict(CruUmowy().list_sources()) == {"dump": CruDump}


def test_large_derived_output_stays_local() -> None:
    assert CruUmowy.backup_to_shared_cache is False


def test_the_output_path_is_the_usual_shape() -> None:
    assert CruUmowy().output_path() == "cru_umowy/cru_umowy.jsonl"


def test_a_full_run_emits_every_contract_and_stub(wired, tmp_path, monkeypatch) -> None:
    pipeline, ctx, written = wired
    monkeypatch.setattr(pipeline, "prepare_temp_output", lambda: None)

    result = pipeline.process(ctx)

    assert len(written) == 4  # 3 contracts + 1 detail-less stub
    assert {r.zrodlo for r in written} == {"umowa", "wynik"}
    # The rows went through the dumper into the .tmp file; returning them here
    # too would make pandas write the whole output a second time.
    assert result.empty


def test_a_run_never_touches_the_database(wired, monkeypatch) -> None:
    pipeline, ctx, _ = wired
    monkeypatch.setattr(pipeline, "prepare_temp_output", lambda: None)
    pipeline.process(ctx)  # the patched Popen would raise if it did


def test_records_survive_the_jsonl_round_trip(wired, tmp_path, monkeypatch) -> None:
    """What is written must read back as the same dataclass.

    `iterate_pipeline` is how every downstream consumer reads a pipeline's
    output, and dacite reconstructs the nested `strony`/`zmiany_umowy` from
    plain dicts.
    """
    pipeline, ctx, written = wired
    monkeypatch.setattr(pipeline, "prepare_temp_output", lambda: None)
    pipeline.process(ctx)

    output = tmp_path / "cru_umowy.jsonl"
    with output.open("w", encoding="utf-8") as handle:
        for record in written:
            handle.write(json.dumps(_asdict(record), ensure_ascii=False) + "\n")

    df = pd.read_json(output, lines=True, dtype=dict.fromkeys(CruUmowy.dtype, str))
    restored: list[CruUmowa] = list(iterate_pipeline(df, CruUmowa))

    assert len(restored) == 4
    by_id = {r.id_umowy: r for r in restored}
    contract = by_id["aaaaaaaa-0000-4000-8000-000000000001"]
    assert contract.strony[0].nazwa == "URZĄD MIASTA LEGIONOWO"
    assert contract.zmiany_umowy[0].data_zmiany == "2026-07-20"


def test_dtype_protects_leading_zero_identifiers(wired, tmp_path, monkeypatch) -> None:
    """Without `dtype`, pandas reads REGON "000524832" as the integer 524832."""
    pipeline, ctx, written = wired
    monkeypatch.setattr(pipeline, "prepare_temp_output", lambda: None)
    pipeline.process(ctx)

    output = tmp_path / "cru_umowy.jsonl"
    with output.open("w", encoding="utf-8") as handle:
        for record in written:
            handle.write(json.dumps(_asdict(record), ensure_ascii=False) + "\n")

    unprotected = pd.read_json(output, lines=True)
    protected = pd.read_json(
        output, lines=True, dtype=dict.fromkeys(CruUmowy.dtype, str)
    )

    row = protected[protected["id_umowy"] == "aaaaaaaa-0000-4000-8000-000000000001"]
    assert row["zamawiajacy_regon"].iloc[0] == "000524832"
    # The failure this guards against, demonstrated:
    naive = unprotected[
        unprotected["id_umowy"] == "aaaaaaaa-0000-4000-8000-000000000001"
    ]
    assert str(naive["zamawiajacy_regon"].iloc[0]) != "000524832"


def _asdict(record: CruUmowa) -> dict:
    return dataclasses.asdict(record)
