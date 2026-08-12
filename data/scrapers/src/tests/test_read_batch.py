"""Reading back a prefix that was crawled in batches.

`BatchClient.batch_upload` writes one tar.gz per hostname per day instead of
an object per response, so a listing of such a prefix returns archives where
every other prefix returns responses. `Conductor.read_many` unpacks them, and
has to hand the members back under the names they would have had unbatched --
every KRS pipeline reads the object path for the KRS number, the crawl date
and which source a fact came from.
"""

import io
import tarfile

import pytest

from conductor import Conductor
from scrapers.stores import CloudStorage
from scrapers.stores.file import DownloadableFile
from stores.duckdb import EntityDumper

HOST = "wyszukiwarka-msig.ms.gov.pl"
BUCKET = "gs://koryta-pl-crawled"


@pytest.fixture
def archive(tmp_path):
    """A batch holding two responses and the index the batcher appends."""
    path = tmp_path / "uid_0199.tar.gz"
    with tarfile.open(path, "w:gz") as tar:
        for name, body in [
            (f"{HOST}/api/Monitor/Detalis/?Id=1", b'{"id": 1}'),
            (f"{HOST}/api/Monitor/Detalis/?Id=2", b'{"id": 2}'),
            ("index.txt", b"two\n"),
        ]:
            info = tarfile.TarInfo(name=name)
            info.size = len(body)
            tar.addfile(info, io.BytesIO(body))
    return path


@pytest.fixture
def conductor(archive, monkeypatch):
    blob = f"{BUCKET}/hostname={HOST}/date=2026-08-12/uid_0199.tar.gz"
    reader = Conductor(EntityDumper())
    monkeypatch.setattr(
        reader, "list_files", lambda _path: [DownloadableFile(blob)]
    )
    monkeypatch.setattr(reader, "read_data", lambda _ref: _Local(str(archive)))
    # The mirror holds no snapshot of this host, which is what puts read_many
    # on the listing path in the first place.
    monkeypatch.setattr(
        type(reader.mirror), "bulk_reads_enabled", property(lambda _self: False)
    )
    return reader


class _Local:
    def __init__(self, path: str) -> None:
        self.path = path


def read(conductor):
    return list(conductor.read_many(CloudStorage(prefix=f"hostname={HOST}")))


def test_members_are_returned_as_the_objects_they_stand_for(conductor):
    assert [name for name, _ in read(conductor)] == [
        f"{BUCKET}/hostname={HOST}/api/Monitor/Detalis/?Id=1/date=2026-08-12",
        f"{BUCKET}/hostname={HOST}/api/Monitor/Detalis/?Id=2/date=2026-08-12",
    ]


def test_the_batchers_own_index_is_not_one_of_them(conductor):
    assert not any("index.txt" in name for name, _ in read(conductor))


def test_contents_come_through(conductor):
    assert [blob.read_string() for _, blob in read(conductor)] == [
        '{"id": 1}',
        '{"id": 2}',
    ]
