"""Which Wikipedia dump the wiki pipelines read, and how hard they read it.

The default is the rolling `latest` dump, which is what an interactive run
wants. CI pins a dated dump instead: `latest` rotates roughly twice a month, so
a nightly built on it cannot tell "the pipeline broke" from "Wikipedia changed",
and no download cache key on it can ever be stable.

The multistream dump is also published as numbered shards (~230 MB each against
2.9 GB for the whole thing). Pointing --wiki-dump-url at one gives a real,
parseable subset -- enough to exercise the pipeline on a pull request without
paying for the full pass. The shards' page-id ranges are not predictable from
the date, so the caller passes the resolved URL rather than a shard number.

Runtime config here goes through parse_known_args, same as
`stores.download.FileSource` and `scrapers.koryta.differ`, so these flags can be
handed straight to `koryta`.
"""

import argparse
import multiprocessing
from functools import cache

from scrapers.stores.file import DownloadableFile

LATEST_DUMP_URL = (
    "https://dumps.wikimedia.org/plwiki/latest/"
    "plwiki-latest-pages-articles-multistream.xml.bz2"
)

# The name the rolling dump has always been cached under. Kept as the default so
# an existing `downloaded/` does not have to be refetched.
LATEST_DUMP_FILENAME = "plwiki-latest-articles.xml.bz2"

# What the full dump expands to, used only as a tqdm total -- the download
# itself is ~2.9 GB. A shard has no size we can know without asking the network.
FULL_DUMP_BYTES = 12314670146

# Suffix shared by every unsharded multistream dump, whatever its date.
_FULL_DUMP_SUFFIX = "pages-articles-multistream.xml.bz2"


def add_arguments(parser: argparse.ArgumentParser) -> None:
    """Registers the dump flags on a parser.

    Every entry point that takes positional arguments has to call this, not
    just the one that reads them: parse_known_args sets an unknown *flag*
    aside but leaves its value looking like a positional, so `koryta` would
    otherwise take the dump URL for a pipeline name.
    """
    parser.add_argument(
        "--wiki-dump-url",
        default=LATEST_DUMP_URL,
        help="Wikipedia dump to process. Pin a dated dump for a reproducible "
        "run, or a multistream shard for a cheap partial one.",
    )
    parser.add_argument(
        "--wiki-dump-file",
        default=None,
        help="Name to cache the dump under in downloaded/. Defaults to the "
        "URL's basename.",
    )
    parser.add_argument(
        "--wiki-dump-bytes",
        type=int,
        default=None,
        help="Uncompressed size of the dump, for the progress bar only. 0 "
        "means unknown.",
    )
    parser.add_argument(
        "--wiki-workers",
        type=int,
        default=0,
        help="Worker processes for parsing articles. 0 picks from the CPU "
        "count.",
    )


@cache
def _args():
    parser = argparse.ArgumentParser()
    add_arguments(parser)
    return parser.parse_known_args()[0]


@cache
def wiki_dump() -> DownloadableFile:
    """The dump the wiki pipelines read."""
    args = _args()
    filename = args.wiki_dump_file
    if filename is None:
        filename = (
            LATEST_DUMP_FILENAME
            if args.wiki_dump_url == LATEST_DUMP_URL
            else args.wiki_dump_url.rsplit("/", 1)[-1]
        )
    return DownloadableFile(args.wiki_dump_url, filename)


def dump_bytes() -> int | None:
    """tqdm total for one pass over the decompressed dump, None when unknown.

    tqdm handles a None total by counting bytes without a percentage, which is
    the honest thing to show for a shard.
    """
    args = _args()
    if args.wiki_dump_bytes is not None:
        return args.wiki_dump_bytes or None
    if args.wiki_dump_url.endswith(_FULL_DUMP_SUFFIX):
        return FULL_DUMP_BYTES
    return None


def wiki_workers() -> int:
    """How many processes to parse articles with.

    Was a hardcoded 8, which oversubscribes the 4-core runners CI gets.
    """
    args = _args()
    if args.wiki_workers > 0:
        return args.wiki_workers
    return min(8, multiprocessing.cpu_count())
