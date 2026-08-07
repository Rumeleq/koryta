import dataclasses
import os
import sys
import time
import typing

import firebase_admin
import requests
from firebase_admin import firestore

from entities.composite import PersonScore

#: Firestore takes at most 500 operations in one batch.
BATCH_LIMIT = 500


@dataclasses.dataclass(frozen=True)
class ScoreWrite:
    """One thing to do to one model's vote on one node.

    A `score` of None is a retraction: the model no longer rates that person,
    so its vote document goes away rather than being set to zero, which would
    leave a vote nobody cast.
    """

    node_id: str
    score: float | None = None

    @property
    def retracts(self) -> bool:
        return self.score is None


class Firestore:
    def __init__(self, args):
        project_id = getattr(args, "project", None)
        if args.endpoint.startswith("http://localhost"):
            os.environ["FIRESTORE_EMULATOR_HOST"] = "localhost:8080"
            if not project_id:
                try:
                    resp = requests.get("http://127.0.0.1:4000/api/config", timeout=2)
                    if resp.status_code == 200:
                        project_id = resp.json().get("projectId")
                except Exception as e:
                    print(
                        f"Warning: Could not detect emulator project ID: {e}",
                        file=sys.stderr,
                    )
                if not project_id:
                    project_id = "demo-koryta-pl"

        options = {}
        if project_id:
            options["projectId"] = project_id

        try:
            app = firebase_admin.get_app("uploader")
        except ValueError:
            app = firebase_admin.initialize_app(options=options, name="uploader")

        database_id = getattr(args, "database", "koryta-pl")
        self.db = firestore.client(app=app, database_id=database_id)
        self.user_id = "pipeline"

    def vote_id(self, node_id: str, user_uid: str) -> str:
        return f"{node_id}_{user_uid}"

    def existing_scores(self, model: str) -> dict[str, int]:
        """Node id -> the score this model last wrote, for the whole model.

        One equality query on `userUid`, which the automatic single-field index
        covers, and it returns only this model's own documents.
        """
        existing = {}
        query = self.db.collection("votes").where(
            filter=firestore.FieldFilter("userUid", "==", model)
        )
        for doc in query.stream():
            data = doc.to_dict() or {}
            node_id = data.get("nodeId")
            interesting = (data.get("categoryVotes") or {}).get("interesting")
            if node_id and interesting is not None:
                existing[node_id] = interesting
        return existing

    def submit_score(self, p: dict | PersonScore):
        """Write one model's rating of one person."""
        if isinstance(p, dict):
            p = PersonScore(**p)

        print(
            f"Uploading score {p.score} for {p.name} (nodeId: {p.node_id})...",
            end=" ",
            file=sys.stderr,
        )

        doc_ref = self.db.collection("votes").document(
            self.vote_id(p.node_id, p.model or self.user_id)
        )
        doc_ref.set(
            {
                "nodeId": p.node_id,
                "userUid": p.model or self.user_id,
                "categoryVotes": {"interesting": p.score},
            },
            merge=True,
        )
        print(f"  OK: {doc_ref.id}", file=sys.stderr)

    def plan_scores(
        self, model: str, scores: list[PersonScore], retract: bool = True
    ) -> list[ScoreWrite]:
        """What it would take for this model's stored opinion to match `scores`.

        Written as a diff against what the model wrote last time rather than as
        a blind overwrite, for two reasons. Every vote document written fires
        `onVoteWritten`, which re-reads every vote on that node and rewrites the
        node's aggregate, so a run that re-states 40k unchanged scores costs 40k
        function invocations to change nothing. And a person the model no longer
        rates has to lose the score rather than keep a stale one - deleting the
        document says "this model has no opinion", which is what the site should
        show.

        `retract` is off when the caller only read part of the run: a partial
        input cannot tell a dropped score from one that was never sent. It says
        nothing about uploading the plan in instalments - the plan below is
        complete however slowly `apply_scores` gets through it.
        """
        existing = self.existing_scores(model)
        wanted = {s.node_id: s for s in scores}

        changed = [
            ScoreWrite(node_id, s.score)
            for node_id, s in wanted.items()
            if existing.get(node_id) != s.score
        ]
        stale = (
            [ScoreWrite(node_id) for node_id in existing if node_id not in wanted]
            if retract
            else []
        )

        print(
            f"{model}: {len(wanted)} scores, {len(existing)} already stored -> "
            f"{len(changed)} to write, {len(stale)} to retract"
            + ("" if retract else " (retraction skipped for a partial input)"),
            file=sys.stderr,
        )

        return changed + stale

    def apply_scores(
        self,
        model: str,
        operations: list[ScoreWrite],
        batch_size: int = BATCH_LIMIT,
        pause: float = 0.0,
        on_batch: typing.Callable[[int], None] | None = None,
    ) -> int:
        """Send a plan to Firestore a batch at a time, resting in between.

        Every vote written fires `onVoteWritten`, which queries every vote on
        that node and rewrites the node's aggregate, so a model's whole
        shortlist pushed as fast as the network allows arrives as tens of
        thousands of function invocations at once. `batch_size` and `pause`
        together set the ceiling on how fast that queue grows.

        `on_batch` runs with the batch's size after each commit that lands, so
        a caller can record what has already been applied and pick up the rest
        later. Anything it has not been told about has not been written.
        """
        if not 0 < batch_size <= BATCH_LIMIT:
            raise ValueError(
                f"batch_size must be between 1 and {BATCH_LIMIT}, got {batch_size}"
            )

        collection = self.db.collection("votes")
        applied = 0
        for start in range(0, len(operations), batch_size):
            chunk = operations[start : start + batch_size]
            # Between batches only: no reason to make the caller wait at the end
            # for a rest nothing follows.
            if applied and pause:
                time.sleep(pause)

            batch = self.db.batch()
            for operation in chunk:
                document = collection.document(self.vote_id(operation.node_id, model))
                if operation.retracts:
                    batch.delete(document)
                else:
                    batch.set(
                        document,
                        {
                            "nodeId": operation.node_id,
                            "userUid": model,
                            "categoryVotes": {"interesting": operation.score},
                        },
                        merge=True,
                    )
            batch.commit()

            applied += len(chunk)
            print(f"  committed {applied}/{len(operations)}...", file=sys.stderr)
            if on_batch is not None:
                on_batch(len(chunk))

        return applied

    def replace_scores(
        self, model: str, scores: list[PersonScore], retract: bool = True, **kwargs
    ) -> tuple[int, int]:
        """Plan and apply in one go, for callers with nothing to resume from."""
        operations = self.plan_scores(model, scores, retract)
        self.apply_scores(model, operations, **kwargs)
        written = sum(1 for operation in operations if not operation.retracts)
        return written, len(operations) - written
