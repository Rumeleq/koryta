"""Uploading a model's shortlist: what gets written, what gets taken back, and
what a run that did not finish leaves behind for the next one.

The score path is the one uploader that deletes, and the one that paces itself
across runs, so it is the one worth a test.
"""

import typing
import unittest.mock

import pytest

from entities.composite import PersonScore
from stores.upload_state import UploadState, target_slug
from uploader import Args, ScoreUploader
from util.firestore import Firestore, ScoreWrite


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


class TestBatching:
    """How the plan leaves, rather than what is in it."""

    def plan(self, count: int) -> list[ScoreWrite]:
        return [ScoreWrite(f"n{i}", i) for i in range(count)]

    def test_a_batch_never_exceeds_the_size_asked_for(self):
        # Firestore refuses a batch over 500, and the backend is what the
        # smaller sizes are actually for: each commit is a burst of aggregate
        # triggers, and the size is how big a burst gets.
        client = firestore_with()
        commits = []
        client.apply_scores(
            "pipeline", self.plan(25), batch_size=10, on_batch=commits.append
        )

        assert commits == [10, 10, 5]
        assert len(client.db.log) == 25  # type: ignore[attr-defined]

    def test_it_rests_between_batches_but_not_after_the_last(self):
        client = firestore_with()
        slept = []
        with unittest.mock.patch("util.firestore.time.sleep", slept.append):
            client.apply_scores("pipeline", self.plan(25), batch_size=10, pause=2.5)

        assert slept == [2.5, 2.5]

    def test_a_batch_size_firestore_would_reject_is_refused_up_front(self):
        client = firestore_with()

        with pytest.raises(ValueError, match="between 1 and 500"):
            client.apply_scores("pipeline", self.plan(1), batch_size=501)
        with pytest.raises(ValueError, match="between 1 and 500"):
            client.apply_scores("pipeline", self.plan(1), batch_size=0)

    def test_the_caller_only_hears_about_batches_that_landed(self):
        # What `on_batch` reports is what a resume trusts as already written,
        # so a commit that raised must not be counted.
        client = firestore_with()
        commits = []
        original = client.db.batch  # type: ignore[attr-defined]

        def failing_batch():
            batch = original()
            if len(client.db.log) >= 20:  # type: ignore[attr-defined]
                batch.commit = _raise
            return batch

        client.db.batch = failing_batch  # type: ignore[attr-defined]
        with pytest.raises(RuntimeError):
            client.apply_scores(
                "pipeline", self.plan(50), batch_size=10, on_batch=commits.append
            )

        assert commits == [10, 10]


def _raise():
    raise RuntimeError("network went away")


class TestUploadState:
    def plan(self, count: int) -> list[ScoreWrite]:
        return [ScoreWrite(f"n{i}", i) for i in range(count)]

    def test_what_is_left_survives_the_process_that_was_sending_it(self, tmp_path):
        state = UploadState.start(
            "pipeline", "prod_koryta-pl", self.plan(5), str(tmp_path)
        )
        state.advance(2)

        reloaded = UploadState.load(state.path)

        assert reloaded is not None
        assert reloaded.pending == [
            ScoreWrite("n2", 2),
            ScoreWrite("n3", 3),
            ScoreWrite("n4", 4),
        ]
        assert (reloaded.planned, reloaded.applied) == (5, 2)

    def test_a_retraction_survives_the_round_trip_as_a_retraction(self):
        # A retraction is `score is None`, and JSON has null, so this only
        # holds as long as nothing helpfully coerces it to zero on the way -
        # which would write a vote nobody cast instead of deleting one.
        assert ScoreWrite("n1").retracts
        assert not ScoreWrite("n1", 0).retracts

    def test_a_finished_run_leaves_no_file_behind(self, tmp_path):
        # A state file existing at all is what `--resume` reads as "there is
        # work outstanding", so a drained one has to go.
        state = UploadState.start(
            "pipeline", "prod_koryta-pl", self.plan(2), str(tmp_path)
        )
        state.advance(2)
        state.finish()

        assert UploadState.load(state.path) is None
        assert UploadState.pending_runs("prod_koryta-pl", directory=str(tmp_path)) == []

    def test_a_plan_for_another_firestore_is_not_resumed_into_this_one(self, tmp_path):
        # Resuming a dev machine's leftovers against autopush would write a
        # local emulator's opinions to production.
        UploadState.start(
            "pipeline", "localhost-3000_koryta-pl", self.plan(3), str(tmp_path)
        )
        UploadState.start(
            "pipeline", "autopush.koryta.pl_koryta-pl", self.plan(4), str(tmp_path)
        )

        outstanding = UploadState.pending_runs(
            "autopush.koryta.pl_koryta-pl", directory=str(tmp_path)
        )

        assert [(s.model, s.planned) for s in outstanding] == [("pipeline", 4)]

    def test_one_model_can_be_resumed_without_the_others(self, tmp_path):
        UploadState.start(
            "pipeline-pagerank", "prod_koryta-pl", self.plan(3), str(tmp_path)
        )
        UploadState.start(
            "pipeline-capture", "prod_koryta-pl", self.plan(4), str(tmp_path)
        )

        every = UploadState.pending_runs("prod_koryta-pl", directory=str(tmp_path))
        one = UploadState.pending_runs(
            "prod_koryta-pl", "pipeline-capture", directory=str(tmp_path)
        )

        assert [s.model for s in every] == ["pipeline-capture", "pipeline-pagerank"]
        assert [s.model for s in one] == ["pipeline-capture"]

    def test_a_half_written_state_file_is_not_read_as_an_empty_run(self, tmp_path):
        path = tmp_path / "pipeline__prod_koryta-pl.json"
        path.write_text('{"model": "pipeline", "pend')

        assert UploadState.load(str(path)) is None

    def test_two_targets_do_not_share_a_file(self):
        assert target_slug("http://localhost:3000", "koryta-pl") != target_slug(
            "https://autopush.koryta.pl", "koryta-pl"
        )
        assert target_slug("https://autopush.koryta.pl", "koryta-pl") == (
            "autopush.koryta.pl_koryta-pl"
        )
        assert "/" not in target_slug("http://localhost:3000/", "koryta-pl")


def uploader_with(**overrides) -> ScoreUploader:
    args = typing.cast(Args, Args())
    args.model = overrides.get("model")
    args.limit = overrides.get("limit")
    args.offset = overrides.get("offset")
    args.endpoint = overrides.get("endpoint", "https://autopush.koryta.pl")
    args.database = overrides.get("database", "koryta-pl")
    args.batch_size = overrides.get("batch_size", 10)
    args.batch_pause = overrides.get("batch_pause", 0.0)
    args.max_operations = overrides.get("max_operations")
    args.resume = overrides.get("resume", False)
    args.state_dir = overrides.get("state_dir", "")
    args.submit = overrides.get("submit", True)
    instance = ScoreUploader.__new__(ScoreUploader)
    instance.args = args
    instance.firestore = overrides.get("firestore")  # type: ignore[assignment]
    return instance


class TestSubmitAndResume:
    def rows(self, count: int) -> list[dict]:
        return [
            {"node_id": f"n{i}", "name": f"p{i}", "score": i + 1, "model": "pipeline"}
            for i in range(count)
        ]

    def test_a_capped_run_sends_a_slice_and_keeps_the_rest(self, tmp_path):
        client = firestore_with()
        uploader = uploader_with(
            firestore=client, state_dir=str(tmp_path), max_operations=4, batch_size=2
        )

        uploader.submit_results(self.rows(10))

        assert len(client.db.log) == 4  # type: ignore[attr-defined]
        outstanding = UploadState.pending_runs(uploader.target, directory=str(tmp_path))
        assert [len(s.pending) for s in outstanding] == [6]

    def test_resume_finishes_it_without_being_handed_the_rows_again(self, tmp_path):
        # The whole point: regenerating these rows means re-running the
        # pipeline that produced them, which costs far more than the upload.
        client = firestore_with()
        uploader_with(
            firestore=client, state_dir=str(tmp_path), max_operations=4, batch_size=2
        ).submit_results(self.rows(10))

        uploader_with(firestore=client, state_dir=str(tmp_path), batch_size=2).resume()

        assert len(client.db.log) == 10  # type: ignore[attr-defined]
        assert (
            UploadState.pending_runs(uploader_with().target, directory=str(tmp_path))
            == []
        )
        assert client.db.votes.documents["n9_pipeline"]["categoryVotes"] == {  # type: ignore[attr-defined]
            "interesting": 10
        }

    def test_an_interrupted_run_keeps_exactly_what_it_did_not_send(self, tmp_path):
        client = firestore_with()
        uploader = uploader_with(
            firestore=client, state_dir=str(tmp_path), batch_size=2
        )
        original = client.db.batch  # type: ignore[attr-defined]

        def failing_batch():
            batch = original()
            if len(client.db.log) >= 4:  # type: ignore[attr-defined]
                batch.commit = _raise
            return batch

        client.db.batch = failing_batch  # type: ignore[attr-defined]
        with pytest.raises(RuntimeError):
            uploader.submit_results(self.rows(10))

        outstanding = UploadState.pending_runs(uploader.target, directory=str(tmp_path))
        assert [len(s.pending) for s in outstanding] == [6]
        assert outstanding[0].pending[0] == ScoreWrite("n4", 5)

    def test_a_run_with_nothing_to_do_leaves_nothing_outstanding(self, tmp_path):
        client = firestore_with(
            stored("n0", "pipeline", 1), stored("n1", "pipeline", 2)
        )
        uploader = uploader_with(firestore=client, state_dir=str(tmp_path))

        uploader.submit_results(self.rows(2))

        assert client.db.log == []  # type: ignore[attr-defined]
        assert UploadState.pending_runs(uploader.target, directory=str(tmp_path)) == []

    def test_a_fresh_plan_supersedes_what_an_older_one_left(self, tmp_path):
        # The leftovers are not lost work: a plan is a diff against Firestore
        # as it stands, so anything the old run never sent is still missing and
        # turns up in the new plan too.
        client = firestore_with()
        uploader = uploader_with(
            firestore=client, state_dir=str(tmp_path), max_operations=1, batch_size=1
        )
        uploader.submit_results(self.rows(4))
        assert len(client.db.log) == 1  # type: ignore[attr-defined]

        uploader_with(
            firestore=client, state_dir=str(tmp_path), batch_size=1
        ).submit_results(self.rows(4))

        assert len(client.db.log) == 4  # type: ignore[attr-defined]
        assert UploadState.pending_runs(uploader.target, directory=str(tmp_path)) == []

    def test_listing_what_is_outstanding_sends_nothing(self, tmp_path):
        client = firestore_with()
        uploader_with(
            firestore=client, state_dir=str(tmp_path), max_operations=2, batch_size=1
        ).submit_results(self.rows(6))
        before = len(client.db.log)  # type: ignore[attr-defined]

        uploader_with(firestore=client, state_dir=str(tmp_path), submit=False).resume()

        assert len(client.db.log) == before  # type: ignore[attr-defined]


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
