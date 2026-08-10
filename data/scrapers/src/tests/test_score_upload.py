"""Uploading a model's shortlist: what gets written, and what gets taken back.

The score path is the one uploader that deletes, so it is the one worth a test.
"""

import typing

import pytest

from entities.composite import PersonScore
from uploader import Args, ScoreUploader
from util.firestore import Firestore


class FakeDoc:
    def __init__(self, doc_id: str, data: dict):
        self.id = doc_id
        self._data = data

    def to_dict(self):
        return self._data


class FakeQuery:
    def __init__(self, docs: list[FakeDoc]):
        self._docs = docs

    def stream(self):
        return iter(self._docs)


class FakeCollection:
    def __init__(self, documents: dict[str, dict]):
        self.documents = documents

    def where(self, filter=None):  # noqa: A002 - matches the firestore signature
        _, _, value = filter.field_path, filter.op_string, filter.value
        return FakeQuery(
            [
                FakeDoc(doc_id, data)
                for doc_id, data in self.documents.items()
                if data.get("userUid") == value
            ]
        )

    def document(self, doc_id: str) -> str:
        return doc_id


class FakeBatch:
    def __init__(self, collection: FakeCollection, log: list[tuple]):
        self.collection = collection
        self.log = log
        self.pending: list[tuple] = []

    def set(self, ref, data, merge=False):
        self.pending.append(("set", ref, data))

    def delete(self, ref):
        self.pending.append(("delete", ref, None))

    def commit(self):
        for operation, ref, data in self.pending:
            if operation == "set":
                self.collection.documents[ref] = data
            else:
                self.collection.documents.pop(ref, None)
            self.log.append((operation, ref))
        self.pending = []


class FakeDb:
    def __init__(self, documents: dict[str, dict]):
        self.votes = FakeCollection(documents)
        self.log: list[tuple] = []

    def collection(self, name: str) -> FakeCollection:
        assert name == "votes"
        return self.votes

    def batch(self) -> FakeBatch:
        return FakeBatch(self.votes, self.log)


def stored(node_id: str, model: str, score: int) -> tuple[str, dict]:
    return (
        f"{node_id}_{model}",
        {"nodeId": node_id, "userUid": model, "categoryVotes": {"interesting": score}},
    )


def firestore_with(*documents: tuple[str, dict]) -> Firestore:
    client = Firestore.__new__(Firestore)
    client.db = FakeDb(dict(documents))  # type: ignore[assignment]
    client.user_id = "pipeline"
    return client


def score(node_id: str, value: int, model: str) -> PersonScore:
    return PersonScore(node_id=node_id, name=node_id, score=value, model=model)


class TestReplaceScores:
    def test_writes_only_what_changed(self):
        # Every vote written fires the aggregate trigger, so re-stating a score
        # the model already holds is a Cloud Function invocation that changes
        # nothing.
        client = firestore_with(
            stored("n1", "pipeline-pagerank", 5),
            stored("n2", "pipeline-pagerank", 2),
        )

        written, retracted = client.replace_scores(
            "pipeline-pagerank",
            [score("n1", 5, "pipeline-pagerank"), score("n2", 4, "pipeline-pagerank")],
        )

        assert (written, retracted) == (1, 0)
        assert client.db.log == [("set", "n2_pipeline-pagerank")]  # type: ignore[attr-defined]

    def test_a_person_the_model_dropped_loses_the_score(self):
        client = firestore_with(stored("gone", "pipeline-turnover", 3))

        written, retracted = client.replace_scores(
            "pipeline-turnover", [score("kept", 2, "pipeline-turnover")]
        )

        assert (written, retracted) == (1, 1)
        assert "gone_pipeline-turnover" not in client.db.votes.documents  # type: ignore[attr-defined]

    def test_another_models_scores_are_not_touched(self):
        client = firestore_with(
            stored("n1", "pipeline-pagerank", 5),
            stored("n1", "pipeline-capture", 1),
            stored("n1", "aB3xYz", 4),
        )

        client.replace_scores("pipeline-pagerank", [])

        documents = client.db.votes.documents  # type: ignore[attr-defined]
        assert "n1_pipeline-pagerank" not in documents
        assert documents["n1_pipeline-capture"]["categoryVotes"]["interesting"] == 1
        assert documents["n1_aB3xYz"]["categoryVotes"]["interesting"] == 4

    def test_a_partial_upload_retracts_nothing(self):
        client = firestore_with(stored("n1", "pipeline", 5))

        written, retracted = client.replace_scores(
            "pipeline", [score("n2", 3, "pipeline")], retract=False
        )

        assert (written, retracted) == (1, 0)
        assert "n1_pipeline" in client.db.votes.documents  # type: ignore[attr-defined]


def uploader_with(**overrides) -> ScoreUploader:
    args = typing.cast(Args, Args())
    args.model = overrides.get("model")
    args.limit = overrides.get("limit")
    args.offset = overrides.get("offset")
    instance = ScoreUploader.__new__(ScoreUploader)
    instance.args = args
    return instance


class TestModelOf:
    def test_takes_the_tag_the_rows_carry(self):
        uploader = uploader_with()

        assert (
            uploader.model_of([score("n1", 3, "pipeline-capture")])
            == "pipeline-capture"
        )

    def test_refuses_a_run_that_mixes_models(self):
        # Reconciliation is per model: uploading two at once would retract each
        # model's scores on behalf of the other.
        uploader = uploader_with()

        with pytest.raises(ValueError, match="one model per upload"):
            uploader.model_of(
                [score("n1", 3, "pipeline-capture"), score("n2", 3, "pipeline")]
            )

    def test_refuses_a_uid_the_site_would_read_as_a_person(self):
        uploader = uploader_with(model="pagerank")

        with pytest.raises(ValueError, match="human review"):
            uploader.model_of([score("n1", 3, "pipeline-pagerank")])

    def test_an_override_wins_over_the_rows(self):
        uploader = uploader_with(model="pipeline-experiment")

        assert uploader.model_of([score("n1", 3, "pipeline")]) == "pipeline-experiment"
