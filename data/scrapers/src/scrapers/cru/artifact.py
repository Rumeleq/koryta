"""Where the dump artifact lives on disk, and how it gets there safely.

`downloaded/` is shared between jj workspaces (it is a symlink to
`~/.cache/koryta/downloaded`), so two agents can be producing this artifact at
the same time. Every write therefore goes to a uniquely-named `.part` file and
is promoted with a single `Path.replace`, which is atomic within a filesystem:
a reader either sees the whole old artifact or the whole new one, never a
half-written file.
"""

import hashlib
import typing
import uuid
from pathlib import Path

from scrapers.cru import config
from scrapers.stores import DOWNLOADED_DIR

#: Read in chunks rather than whole: the artifact is ~45 MB and there is no
#: reason for two copies of it to be resident at once.
_CHUNK = 1 << 20


def artifact_path(filename: str | None = None) -> Path:
    """The artifact's place in the shared `downloaded/` cache."""
    return Path(DOWNLOADED_DIR) / (filename or config.ARTIFACT_FILENAME)


def sha256_of(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        while chunk := handle.read(_CHUNK):
            digest.update(chunk)
    return digest.hexdigest()


def part_path(final: Path) -> Path:
    """A private staging name beside `final`, unique per writer."""
    return final.with_name(f"{final.name}.part-{uuid.uuid4().hex[:8]}")


def promote(part: Path, final: Path) -> None:
    part.replace(final)


def write_atomically(final: Path, chunks: typing.Iterable[bytes]) -> None:
    """Stage `chunks` beside `final`, then swap it in."""
    final.parent.mkdir(parents=True, exist_ok=True)
    part = part_path(final)
    try:
        with part.open("wb") as handle:
            for chunk in chunks:
                handle.write(chunk)
        promote(part, final)
    except BaseException:
        part.unlink(missing_ok=True)
        raise
