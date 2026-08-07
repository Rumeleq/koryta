"""How far a score upload got, so an interrupted one can be picked up.

A model's shortlist is tens of thousands of votes and every one of them fires
the aggregate trigger, so the upload is paced on purpose - paced slowly enough
that it can be cut short by a Ctrl-C, a dropped connection, or a caller that
only wants to spend so many writes per run. Regenerating the same rows means
re-running the pipeline that produced them, which costs far more than the
upload itself, so the plan goes to disk before the first batch leaves and is
trimmed after each one that lands.

The file holds what is *left*, not what was done: after the last batch there is
nothing to keep and it is deleted, so a state file existing at all means there
is work outstanding.
"""

import dataclasses
import json
import os

from stores.config import VERSIONED_DIR
from util.firestore import ScoreWrite

#: Under versioned/ because these belong to the pipeline run that wrote them,
#: which is exactly what versioned/ is not shared between workspaces for.
STATE_DIR = os.path.join(VERSIONED_DIR, "score_uploads")


def target_slug(endpoint: str, database: str) -> str:
    """Which Firestore a plan was aimed at, as something safe for a filename.

    Part of the state's identity rather than decoration: the same model
    uploaded to a local emulator and to autopush are different runs with
    different pending work, and resuming one into the other would write a
    dev machine's opinions to production.
    """
    host = endpoint.rsplit("://", maxsplit=1)[-1].strip("/")
    return f"{_slug(host)}_{_slug(database)}"


def _slug(value: str) -> str:
    return "".join(c if c.isalnum() or c in "._-" else "-" for c in value)


@dataclasses.dataclass
class UploadState:
    """The operations of one model's plan that have not been written yet."""

    path: str
    model: str
    target: str
    pending: list[ScoreWrite]
    planned: int
    applied: int = 0

    @staticmethod
    def path_for(model: str, target: str, directory: str = STATE_DIR) -> str:
        return os.path.join(directory, f"{_slug(model)}__{target}.json")

    @staticmethod
    def start(
        model: str,
        target: str,
        operations: list[ScoreWrite],
        directory: str = STATE_DIR,
    ) -> "UploadState":
        """Record a fresh plan, replacing whatever was left of an older one.

        Superseding is safe, and is why this does not refuse: a plan is a diff
        against what Firestore holds *now*, so an operation an earlier run
        never got to is still missing from Firestore and turns up in the new
        plan as well. The old file's leftovers are not lost work, they are the
        same work counted twice.
        """
        state = UploadState(
            path=UploadState.path_for(model, target, directory),
            model=model,
            target=target,
            pending=list(operations),
            planned=len(operations),
        )
        state.save()
        return state

    @staticmethod
    def load(path: str) -> "UploadState | None":
        """The state at `path`, or None if there is none worth reading."""
        if not os.path.exists(path):
            return None
        try:
            with open(path, "r") as f:
                raw = json.load(f)
            return UploadState(
                path=path,
                model=raw["model"],
                target=raw["target"],
                pending=[
                    ScoreWrite(node_id, score) for node_id, score in raw["pending"]
                ],
                planned=raw["planned"],
                applied=raw["applied"],
            )
        except (OSError, ValueError, KeyError, TypeError) as e:
            print(f"Ignoring unreadable upload state {path}: {e}")
            return None

    @staticmethod
    def pending_runs(
        target: str, model: str | None = None, directory: str = STATE_DIR
    ) -> list["UploadState"]:
        """Every unfinished upload aimed at `target`, oldest model name first."""
        if not os.path.isdir(directory):
            return []

        states = []
        for name in sorted(os.listdir(directory)):
            if not name.endswith(".json"):
                continue
            state = UploadState.load(os.path.join(directory, name))
            if state is None or not state.pending:
                continue
            if state.target != target or (model is not None and state.model != model):
                continue
            states.append(state)
        return sorted(states, key=lambda s: s.model)

    def advance(self, count: int) -> None:
        """Forget the first `count` operations, which have now been written."""
        # Rebinds rather than mutating, so a caller iterating the list it handed
        # to `apply_scores` is not walking a list this is shortening underneath.
        self.pending = self.pending[count:]
        self.applied += count
        self.save()

    def save(self) -> None:
        """Write the state out so that a reader sees all of it or none of it.

        The point of the file is to be read after something went wrong, and the
        thing most likely to go wrong is the process dying - possibly during
        this very write. Rename is atomic, so the file is only ever a complete
        older state or a complete newer one.
        """
        os.makedirs(os.path.dirname(self.path) or ".", exist_ok=True)
        payload = {
            "model": self.model,
            "target": self.target,
            "planned": self.planned,
            "applied": self.applied,
            "pending": [[o.node_id, o.score] for o in self.pending],
        }
        temporary = f"{self.path}.tmp"
        with open(temporary, "w") as f:
            json.dump(payload, f)
        os.replace(temporary, self.path)

    def finish(self) -> None:
        """Drop the file: nothing is outstanding, so nothing is worth keeping."""
        for path in (self.path, f"{self.path}.tmp"):
            if os.path.exists(path):
                os.remove(path)
