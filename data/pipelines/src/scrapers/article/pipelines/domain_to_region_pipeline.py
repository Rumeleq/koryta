"""Publish the static domain->region map to versioned + the shared cache.

The domain->region mapping is an input file, not a generated artifact: it maps
each crawled news domain to the województwa/powiaty (with TERYT codes) it
covers, and is maintained by hand next to the other input files under
``files/`` (gitignored, like ``seed.csv``). This pipeline only copies it into
the versioned output and, because it opts into the shared cache
(``backup_to_shared_cache``), uploads it to the bucket — so any machine that
runs ArticlePersonMentions can restore it instead of carrying an 800KB json in
git.
"""

from dataclasses import dataclass
from pathlib import Path

import pandas as pd

from scrapers.article.pipelines.incremental import IncrementalJsonlPipeline
from scrapers.stores import VERSIONED_DIR, Context

# The maintained input, kept alongside the other gitignored input data. Pushed
# to versioned and the shared cache by this pipeline; if it is missing here the
# shared-cache restore (or a one-time upload) must provide the file instead.
_INPUT_FILE = (
    Path(__file__).resolve().parents[3].parent / "files" / "domain_to_region.json"
)


@dataclass
class DomainToRegionEntry:
    """One ``{domain: [regions]}`` line of the map.

    The output is a single JSON object, read directly as a whole; this type
    exists so the pipeline satisfies the ``output_class`` contract.
    """

    domain: str
    regions: list[dict[str, str]]


def _copy_input(src: Path, dst: Path) -> None:
    """Copy the maintained input file onto the pipeline output path."""
    if not src.exists():
        raise FileNotFoundError(
            f"Domain->region input {src} not found; keep the map there (it is "
            "gitignored) or restore/upload it through the shared cache."
        )
    dst.parent.mkdir(parents=True, exist_ok=True)
    dst.write_bytes(src.read_bytes())


class DomainToRegion(IncrementalJsonlPipeline[DomainToRegionEntry]):
    filename = "domain_to_region"
    format = "json"
    # Small curated input — safe to share with every runner that needs it.
    backup_to_shared_cache = True

    @property
    def final_output_path(self) -> Path:
        return Path(VERSIONED_DIR) / self.filename / f"{self.filename}.json"

    @property
    def temp_output_path(self) -> Path:
        return Path(VERSIONED_DIR) / self.filename / f"{self.filename}.json.tmp"

    @property
    def output_class(self):
        return DomainToRegionEntry

    def process(self, ctx: Context) -> pd.DataFrame:
        self.prepare_temp_output()
        _copy_input(_INPUT_FILE, self.temp_output_path)
        return pd.DataFrame()
