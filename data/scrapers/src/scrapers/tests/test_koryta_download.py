"""Which export the koryta pipelines read when today's has not landed yet.

The site dumps Firestore once or twice a day, so a pipeline started in the
morning asks for a date that does not exist yet. `KorytaPeople` has always
walked back a day until it found one; `KorytaVotes` did not, and returned an
empty frame instead - which reaches the scoring models as "no human has ever
voted on anybody" rather than as an error. These pin the shared behaviour.
"""

import unittest
from unittest.mock import MagicMock, Mock, patch

import pandas as pd

from scrapers.koryta.download import (
    MAX_EXPORT_LOOKBACK_DAYS,
    FirestoreCollection,
    KorytaCompanies,
    KorytaPeople,
    KorytaVotes,
)
from scrapers.stores import Context


def mock_ctx() -> Mock:
    ctx = Mock(spec=Context)
    ctx.io = Mock()
    ctx.refresh_policy = MagicMock()
    ctx.refresh_policy.should_refresh.return_value = False
    ctx.refresh_policy.refreshed_pipelines = set()
    return ctx


def exports_on(dates: dict[str, pd.DataFrame]):
    """A `FirestoreCollection.process` that only knows about `dates`."""

    def process(self, ctx):
        return dates.get(self.date, pd.DataFrame())

    return process


class TestLatestOnOrBefore(unittest.TestCase):
    def test_uses_the_day_asked_for_when_it_has_an_export(self):
        wanted = pd.DataFrame([{"id": "a"}])
        with patch.object(
            FirestoreCollection, "process", exports_on({"2026-08-07": wanted})
        ):
            df, date = FirestoreCollection.latest_on_or_before(
                mock_ctx(), "votes", date="2026-08-07"
            )
        self.assertEqual(date, "2026-08-07")
        self.assertEqual(len(df), 1)

    def test_walks_back_to_the_most_recent_earlier_export(self):
        wanted = pd.DataFrame([{"id": "a"}])
        with patch.object(
            FirestoreCollection, "process", exports_on({"2026-08-05": wanted})
        ):
            df, date = FirestoreCollection.latest_on_or_before(
                mock_ctx(), "votes", date="2026-08-07"
            )
        # Two days back, and it stops at the first day that has one rather than
        # continuing to the oldest.
        self.assertEqual(date, "2026-08-05")
        self.assertEqual(len(df), 1)

    def test_raises_rather_than_walking_forever_when_there_is_no_export(self):
        with patch.object(FirestoreCollection, "process", exports_on({})):
            with self.assertRaises(FileNotFoundError) as caught:
                FirestoreCollection.latest_on_or_before(
                    mock_ctx(), "votes", date="2026-08-07"
                )
        self.assertIn("votes", str(caught.exception))

    def test_gives_up_after_the_lookback_window(self):
        seen: list[str] = []

        def process(self, ctx):
            seen.append(self.date)
            return pd.DataFrame()

        with patch.object(FirestoreCollection, "process", process):
            with self.assertRaises(FileNotFoundError):
                FirestoreCollection.latest_on_or_before(
                    mock_ctx(), "votes", date="2026-08-07", max_lookback_days=3
                )
        self.assertEqual(seen, ["2026-08-07", "2026-08-06", "2026-08-05", "2026-08-04"])

    def test_default_window_is_the_documented_one(self):
        seen: list[str] = []

        def process(self, ctx):
            seen.append(self.date)
            return pd.DataFrame()

        with patch.object(FirestoreCollection, "process", process):
            with self.assertRaises(FileNotFoundError):
                FirestoreCollection.latest_on_or_before(
                    mock_ctx(), "nodes", "person", "2026-08-07"
                )
        self.assertEqual(len(seen), MAX_EXPORT_LOOKBACK_DAYS + 1)


class TestPipelinesFallBack(unittest.TestCase):
    """Every collection gets the fallback, not just the two that had a loop."""

    def test_votes_read_the_previous_day_rather_than_coming_back_empty(self):
        yesterday = pd.DataFrame(
            [
                {
                    "userUid": "someone",
                    "categoryVotes": {"interesting": 4},
                    "nodeId": "person-1",
                }
            ]
        )
        with patch.object(
            FirestoreCollection, "process", exports_on({"2026-08-06": yesterday})
        ):
            df = KorytaVotes(date="2026-08-07").process(mock_ctx())

        self.assertEqual(len(df), 1)
        self.assertEqual(df.iloc[0]["person_koryta_id"], "person-1")
        self.assertEqual(df.iloc[0]["interesting"], 4)

    def test_votes_still_drop_the_pipeline_s_own(self):
        yesterday = pd.DataFrame(
            [
                {
                    "userUid": "pipeline-pagerank",
                    "categoryVotes": {"interesting": 5},
                    "nodeId": "person-1",
                },
                {
                    "userUid": "human",
                    "categoryVotes": {"interesting": 2},
                    "nodeId": "person-2",
                },
            ]
        )
        with patch.object(
            FirestoreCollection, "process", exports_on({"2026-08-06": yesterday})
        ):
            df = KorytaVotes(date="2026-08-07").process(mock_ctx())

        self.assertEqual(list(df["person_koryta_id"]), ["person-2"])

    def test_people_fall_back_as_they_always_did(self):
        yesterday = pd.DataFrame(
            [
                {
                    "id": "person-1",
                    "name": "Jan Kowalski",
                    "parties": [],
                    "stats": {"isApproved": True, "votes": {"interesting": 3}},
                }
            ]
        )
        with patch.object(
            FirestoreCollection, "process", exports_on({"2026-08-06": yesterday})
        ):
            df = KorytaPeople(date="2026-08-07").process(mock_ctx())

        self.assertEqual(len(df), 1)
        self.assertEqual(df.iloc[0]["full_name"], "Jan Kowalski")
        self.assertTrue(df.iloc[0]["is_public"])

    def test_companies_fall_back_as_they_always_did(self):
        yesterday = pd.DataFrame(
            [{"id": "place-1", "krsNumber": "0000123456", "revision_id": "r1"}]
        )
        with patch.object(
            FirestoreCollection, "process", exports_on({"2026-08-06": yesterday})
        ):
            df = KorytaCompanies(date="2026-08-07").process(mock_ctx())

        self.assertEqual(len(df), 1)
        self.assertEqual(df.iloc[0]["krs"], "0000123456")


if __name__ == "__main__":
    unittest.main()
