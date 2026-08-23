"""What `firestore.rules` lets the score uploader do.

The uploader stopped going through the Admin SDK against a deployed site: a
person's account holds no Firestore IAM role, so it writes over the REST API
with their Firebase id token and is judged by the rules instead. That makes the
rules part of the upload path, and the only honest way to check them is to put
them in front of an emulator and try.

Needs the auth and firestore emulators, so it skips without them:

    cd frontend && devns npx firebase emulators:exec --project demo-koryta-pl \\
        --only auth,firestore \\
        "cd ../data/pipelines && .venv/bin/python -m pytest -m e2e \\
            src/tests/e2e/test_vote_rules.py"
"""

import os
import socket

import firebase_admin
import pytest
import requests
from firebase_admin import auth

from entities.composite import PersonScore
from util.firestore import AdminVotes, RestVotes, vote_id

pytestmark = pytest.mark.e2e

FIRESTORE_HOST = os.environ.get("FIRESTORE_EMULATOR_HOST", "127.0.0.1:8080")
AUTH_HOST = os.environ.get("FIREBASE_AUTH_EMULATOR_HOST", "127.0.0.1:9099")
#: `emulators:exec --project` and the `firestore.database` in firebase.json.
PROJECT = os.environ.get("GCLOUD_PROJECT", "demo-koryta-pl")
DATABASE = "koryta-pl"

MODEL = "pipeline-rules-test"


def listening(host_port: str) -> bool:
    host, _, port = host_port.rpartition(":")
    try:
        with socket.create_connection((host, int(port)), timeout=1):
            return True
    except OSError:
        return False


@pytest.fixture(scope="module", autouse=True)
def emulators():
    for name, host in (("firestore", FIRESTORE_HOST), ("auth", AUTH_HOST)):
        if not listening(host):
            pytest.skip(f"no {name} emulator on {host}")


def id_token(uid: str, **claims) -> str:
    """A signed-in user carrying `claims`, the way the rules will see them.

    The auth emulator issues unsigned tokens, so this needs no credentials -
    the same custom-token exchange the extractor service does in production.
    """
    os.environ.setdefault("GCLOUD_PROJECT", PROJECT)
    try:
        app = firebase_admin.get_app("rules-test")
    except ValueError:
        app = firebase_admin.initialize_app(
            options={"projectId": PROJECT}, name="rules-test"
        )

    custom_token = auth.create_custom_token(uid, claims, app=app)
    response = requests.post(
        f"http://{AUTH_HOST}/identitytoolkit.googleapis.com/v1/"
        "accounts:signInWithCustomToken",
        params={"key": "emulator"},
        json={"token": custom_token.decode(), "returnSecureToken": True},
        timeout=30,
    )
    response.raise_for_status()
    return response.json()["idToken"]


def votes_as(uid: str, **claims) -> RestVotes:
    return RestVotes(
        PROJECT, DATABASE, id_token(uid, **claims), origin=f"http://{FIRESTORE_HOST}"
    )


def score(node_id: str, value: int) -> PersonScore:
    return PersonScore(node_id=node_id, name=node_id, score=value, model=MODEL)


class TestDatascienceMember:
    def test_writes_reads_and_retracts_a_models_scores(self):
        votes = votes_as("analyst", datascience=True)

        votes.apply(MODEL, [score("n1", 5), score("n2", 3)], [])
        assert votes.scores(MODEL) == {"n1": 5, "n2": 3}

        votes.apply(MODEL, [], ["n1", "n2"])
        assert votes.scores(MODEL) == {}

    def test_cannot_vote_in_a_persons_name(self):
        # The claim buys the right to write a model's opinion, not to put a
        # verdict on the site under somebody else's uid.
        votes = votes_as("analyst", datascience=True)

        with pytest.raises(PermissionError):
            votes.apply("aB3xYzHumanLookingUid", [score("n1", 5)], [])

    def test_cannot_disguise_a_vote_as_another_document(self):
        # The document id has to spell out the nodeId and uid it carries,
        # otherwise a write could land on a person's own vote document.
        votes = votes_as("analyst", datascience=True)
        forged = {
            "writes": [
                {
                    "update": {
                        "name": votes.document_name(
                            vote_id("n1", "aB3xYzHumanLookingUid")
                        ),
                        "fields": {
                            "nodeId": {"stringValue": "n1"},
                            "userUid": {"stringValue": MODEL},
                            "categoryVotes": {
                                "mapValue": {
                                    "fields": {"interesting": {"integerValue": "5"}}
                                }
                            },
                        },
                    }
                }
            ]
        }

        response = votes.session.post(f"{votes.documents}:commit", json=forged)

        assert response.status_code == 403, response.text


class TestEveryoneElse:
    def test_a_signed_in_user_without_the_claim_is_refused(self):
        votes = votes_as("passer-by")

        with pytest.raises(PermissionError, match="datascience"):
            votes.apply(MODEL, [score("n1", 5)], [])

    def test_a_person_can_still_cast_their_own_vote(self):
        # The branch the site itself writes through, kept alongside the new one
        # so a change to either is checked against the same emulator.
        votes = votes_as("aB3xYzHumanLookingUid")
        own = {
            "writes": [
                {
                    "update": {
                        "name": votes.document_name(
                            vote_id("n1", "aB3xYzHumanLookingUid")
                        ),
                        "fields": {
                            "nodeId": {"stringValue": "n1"},
                            "userUid": {"stringValue": "aB3xYzHumanLookingUid"},
                            "categoryVotes": {
                                "mapValue": {
                                    "fields": {"interesting": {"integerValue": "5"}}
                                }
                            },
                        },
                    }
                }
            ]
        }

        response = votes.session.post(f"{votes.documents}:commit", json=own)

        assert response.status_code == 200, response.text


class TestLocalStack:
    """The other way in: the Admin SDK, which the emulator asks nothing of."""

    def test_writes_reads_and_retracts_a_models_scores(self):
        os.environ["FIRESTORE_EMULATOR_HOST"] = FIRESTORE_HOST
        votes = AdminVotes(PROJECT, DATABASE)
        model = f"{MODEL}-admin"

        votes.apply(model, [score("n1", 5), score("n2", 3)], [])
        assert votes.scores(model) == {"n1": 5, "n2": 3}

        votes.apply(model, [], ["n1", "n2"])
        assert votes.scores(model) == {}
