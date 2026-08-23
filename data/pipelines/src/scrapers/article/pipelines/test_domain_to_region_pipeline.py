"""Tests for the DomainToRegion carrier pipeline."""

from pathlib import Path

import pytest

from scrapers.article.pipelines.domain_to_region_pipeline import (
    DomainToRegion,
    _copy_input,
)

SAMPLE = '{"06-400.pl": [{"woj": "Mazowieckie"}]}\n'


def test_backup_to_shared_cache_is_true():
    assert DomainToRegion.backup_to_shared_cache is True


def test_output_paths_are_json_and_match_shared_cache_slot():
    pipeline = DomainToRegion()
    assert pipeline.final_output_path.name == "domain_to_region.json"
    assert pipeline.temp_output_path.name == "domain_to_region.json.tmp"
    # The shared-cache upload/restore hooks use output_path(); it must point at
    # the same file the pipeline writes.
    assert pipeline.output_path() == "domain_to_region/domain_to_region.json"


def test_copy_input_copies_and_creates_parent(tmp_path: Path):
    src = tmp_path / "src" / "domain_to_region.json"
    src.parent.mkdir()
    src.write_text(SAMPLE, encoding="utf-8")
    dst = tmp_path / "versioned" / "domain_to_region" / "domain_to_region.json"

    _copy_input(src, dst)

    assert dst.read_text(encoding="utf-8") == SAMPLE


def test_copy_input_missing_source_raises(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        _copy_input(tmp_path / "missing.json", tmp_path / "out.json")
