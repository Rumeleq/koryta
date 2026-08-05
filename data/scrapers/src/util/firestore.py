import os
import sys

import firebase_admin
import requests
from firebase_admin import firestore

from entities.composite import PersonScore

#: Firestore takes at most 500 operations in one batch.
BATCH_LIMIT = 500


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

    def replace_scores(
        self, model: str, scores: list[PersonScore], retract: bool = True
    ) -> tuple[int, int]:
        """Make this model's stored opinion match the run that just finished.

        Written as a diff against what the model wrote last time rather than as
        a blind overwrite, for two reasons. Every vote document written fires
        `onVoteWritten`, which re-reads every vote on that node and rewrites the
        node's aggregate, so a run that re-states 40k unchanged scores costs 40k
        function invocations to change nothing. And a person the model no longer
        rates has to lose the score rather than keep a stale one - deleting the
        document says "this model has no opinion", which is what the site should
        show, whereas writing a zero leaves a vote nobody cast.

        `retract` is off when the caller only uploaded part of the run: a
        partial upload cannot tell a dropped score from one that was never sent.
        """
        existing = self.existing_scores(model)
        wanted = {s.node_id: s for s in scores}

        changed = [
            s for node_id, s in wanted.items() if existing.get(node_id) != s.score
        ]
        stale = (
            [node_id for node_id in existing if node_id not in wanted]
            if retract
            else []
        )

        print(
            f"{model}: {len(wanted)} scores, {len(existing)} already stored -> "
            f"{len(changed)} to write, {len(stale)} to retract"
            + ("" if retract else " (retraction skipped for a partial upload)"),
            file=sys.stderr,
        )

        collection = self.db.collection("votes")
        operations = 0
        batch = self.db.batch()
        for score in changed:
            batch.set(
                collection.document(self.vote_id(score.node_id, model)),
                {
                    "nodeId": score.node_id,
                    "userUid": model,
                    "categoryVotes": {"interesting": score.score},
                },
                merge=True,
            )
            operations += 1
            if operations % BATCH_LIMIT == 0:
                batch.commit()
                batch = self.db.batch()
                print(f"  committed {operations}...", file=sys.stderr)

        for node_id in stale:
            batch.delete(collection.document(self.vote_id(node_id, model)))
            operations += 1
            if operations % BATCH_LIMIT == 0:
                batch.commit()
                batch = self.db.batch()
                print(f"  committed {operations}...", file=sys.stderr)

        if operations % BATCH_LIMIT:
            batch.commit()

        return len(changed), len(stale)
