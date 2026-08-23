"""A cached download has to be all there or not there at all."""

import os

import pytest

from stores.storage import Client


class FakeBlob:
    """A GCS blob whose transfer fails part-way, as a dropped one does."""

    def __init__(self, text: str, fail_after: int | None = None):
        self.text = text
        self.fail_after = fail_after

    def download_as_text(self) -> str:
        if self.fail_after is not None:
            raise ConnectionError("connection reset")
        return self.text

    def download_to_filename(self, path: str) -> None:
        with open(path, "w") as out:
            out.write(self.text[: self.fail_after])
        if self.fail_after is not None:
            raise ConnectionError("connection reset")


class FakeBucket:
    def __init__(self, blob: FakeBlob):
        self._blob = blob

    def blob(self, name: str) -> FakeBlob:
        return self._blob


class FakeStorage:
    def __init__(self, blob: FakeBlob):
        self._bucket = FakeBucket(blob)

    def bucket(self, name: str) -> FakeBucket:
        return self._bucket


def client(blob: FakeBlob) -> Client:
    instance = Client.__new__(Client)
    instance.storage_client = FakeStorage(blob)  # type: ignore[attr-defined]
    return instance


@pytest.mark.parametrize("binary", [True, False], ids=["binary", "text"])
def test_a_complete_download_lands_at_the_path(tmp_path, binary):
    target = tmp_path / "blob.json"

    client(FakeBlob('{"ok": true}')).download_from_gcs(
        "hostname=x/thing", str(target), binary
    )

    assert target.read_text() == '{"ok": true}'
    assert os.listdir(tmp_path) == ["blob.json"]


@pytest.mark.parametrize("binary", [True, False], ids=["binary", "text"])
def test_an_interrupted_download_leaves_nothing_behind(tmp_path, binary):
    """The bug this guards: a truncated file is a cache hit for ever.

    `FileSource.downloaded()` asks only whether the path exists, so half a
    document at the real path is never re-fetched - and the half only shows up
    as a parse error somewhere else entirely.
    """
    target = tmp_path / "blob.json"
    blob = FakeBlob('{"ok": true}', fail_after=5)

    with pytest.raises(ConnectionError):
        client(blob).download_from_gcs("hostname=x/thing", str(target), binary)

    assert not target.exists()
    assert os.listdir(tmp_path) == []


def test_an_interrupted_download_does_not_replace_a_good_cached_file(tmp_path):
    target = tmp_path / "blob.json"
    target.write_text('{"ok": true}')

    with pytest.raises(ConnectionError):
        client(FakeBlob("truncat", fail_after=3)).download_from_gcs(
            "hostname=x/thing", str(target), True
        )

    assert target.read_text() == '{"ok": true}'
