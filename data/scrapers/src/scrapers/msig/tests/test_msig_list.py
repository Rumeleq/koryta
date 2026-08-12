"""The pipelines, over a bucket of crawled announcements."""

import json

import pytest
from pandas import DataFrame

from scrapers.msig import api
from scrapers.msig.list import CompanyMSiG, MSiGCrawled, PeopleMSiG
from scrapers.msig.tests.test_msig_entries import WPIS_KOLEJNY, WPIS_PIERWSZY
from scrapers.stores import Context, ProcessPolicy
from scrapers.test_tree import MockNLP, MockRejestrIO, MockUtils, MockWeb

BUCKET = "gs://koryta-pl-crawled"
PREFIX = f"{BUCKET}/hostname={api.HOSTNAME}"


def details_blob(announcement_id: str, crawled: str = "2026-08-12") -> str:
    return f"{PREFIX}/api/Monitor/Detalis/?Id={announcement_id}/date={crawled}"


def search_blob(krs: str, page: int = 1, crawled: str = "2026-08-12") -> str:
    return (
        f"{PREFIX}/api/Monitor/Search/?from=2001-01-01/?krs={krs}"
        f"/?page={page}/?signatureType=B/?to=2026-08-12/date={crawled}"
    )


def announcement(
    announcement_id, krs, body, published, name="SPÓŁKA  JAWNA.", nip=None
):
    return {
        "id": int(announcement_id),
        "krs": krs,
        "nip": nip,
        "entityName": name,
        "monitorNumber": "25/2024",
        "dateOfPublication": f"{published}T00:00:00",
        "chapterName": "XV. WPISY DO KRAJOWEGO REJESTRU SĄDOWEGO/2. Wpisy kolejne",
        "textInPosition": "Poz. 70629.",
        "textInBody": body,
    }


class FakeFile:
    def __init__(self, content: str):
        self.content = content

    def read_string(self) -> str:
        return self.content


class BucketIO:
    """Serves a fixed set of blobs in insertion order, as `read_many` does."""

    def __init__(self, blobs: dict[str, dict | str]):
        self.blobs = blobs

    def read_many(self, path):
        for name, blob in self.blobs.items():
            body = blob if isinstance(blob, str) else json.dumps(blob)
            yield name, FakeFile(body)


@pytest.fixture
def context():
    def build(blobs):
        return Context(
            io=BucketIO(blobs),  # type: ignore[arg-type]
            rejestr_io=MockRejestrIO(),
            con=None,  # type: ignore[arg-type]
            utils=MockUtils(),
            web=MockWeb(),
            nlp=MockNLP(),
            refresh_policy=ProcessPolicy.with_default(),
        )

    return build


def people(ctx) -> DataFrame:
    return PeopleMSiG().process(ctx)


def companies(ctx) -> DataFrame:
    pipeline = CompanyMSiG()
    codes = DataFrame([{"city": "katowice", "postal_code": "40-123", "teryt": "2469"}])
    pipeline.postal_codes.read_or_process = lambda ctx: codes  # type: ignore[method-assign]
    return pipeline.process(ctx)


# ─── PeopleMSiG ──────────────────────────────────────────────


def test_people_carry_the_company_and_the_dates(context):
    ctx = context(
        {details_blob("1"): announcement("1", "0000654243", WPIS_KOLEJNY, "2024-02-05")}
    )
    frame = people(ctx)
    assert set(frame["krs"]) == {"0000654243"}
    assert set(frame["publication_date"]) == {"2024-02-05"}
    # The court made the entry ten days before the Monitor printed it.
    assert set(frame["entry_date"]) == {"2024-01-26"}
    assert set(frame["announcement_id"]) == {"1"}


def test_a_krs_number_is_padded_to_ten_digits(context):
    ctx = context(
        {details_blob("1"): announcement("1", "654243", WPIS_KOLEJNY, "2024-02-05")}
    )
    assert set(people(ctx)["krs"]) == {"0000654243"}


def test_the_same_announcement_crawled_twice_is_counted_once(context):
    """Two sweeps of one company leave two copies of each of its announcements."""
    entry = announcement("1", "0000654243", WPIS_KOLEJNY, "2024-02-05")
    ctx = context(
        {
            details_blob("1", crawled="2026-08-12"): entry,
            details_blob("1", crawled="2026-09-01"): entry,
        }
    )
    once = context({details_blob("1"): entry})
    assert len(people(ctx)) == len(people(once))


def test_a_failed_fetch_is_stored_empty_and_skipped(context):
    ctx = context(
        {
            details_blob("1"): announcement(
                "1", "0000654243", WPIS_KOLEJNY, "2024-02-05"
            ),
            details_blob("2"): "",
        }
    )
    assert set(people(ctx)["announcement_id"]) == {"1"}


def test_search_pages_are_not_read_as_announcements(context):
    entry = announcement("1", "0000654243", WPIS_KOLEJNY, "2024-02-05")
    with_index = context(
        {
            search_blob("0000654243"): {"countPages": 100, "page": 1, "list": []},
            details_blob("1"): entry,
        }
    )
    assert len(people(with_index)) == len(people(context({details_blob("1"): entry})))


def test_an_announcement_naming_nobody_produces_no_rows(context):
    body = "Dz. 3. Rub. 2. Wzmianki o złożonych dokumentach wpisać: 1 1. data złożenia"
    ctx = context(
        {details_blob("1"): announcement("1", "0000654243", body, "2024-02-05")}
    )
    assert people(ctx).empty


# ─── CompanyMSiG ─────────────────────────────────────────────


def test_a_company_takes_its_identity_from_dzial_1(context):
    ctx = context(
        {
            details_blob("1"): announcement(
                "1", "0000147672", WPIS_PIERWSZY, "2003-02-05"
            )
        }
    )
    company = companies(ctx).iloc[0]
    assert company["krs"] == "0000147672"
    assert company["regon"] == "270616654"
    assert company["city"] == "katowice"
    assert company["teryt_code"] == "2469"


def test_a_company_that_states_nothing_falls_back_to_the_search_name(context):
    body = "Dz. 2. Rub. 3. Prokurenci wykreślić: 1 1. NOWAK 2. JAN 3. 69032811497"
    ctx = context(
        {
            details_blob("1"): announcement(
                "1", "0000654243", body, "2024-02-05", name="NOWA SPÓŁKA  JAWNA."
            )
        }
    )
    company = companies(ctx).iloc[0]
    # Tidied on the way through: the doubled space and the full stop are the
    # typesetting, not the name.
    assert company["name"] == "NOWA SPÓŁKA JAWNA"


def test_the_newest_announcement_wins_the_name(context):
    old = "Dz. 1. Rub. 1. Dane podmiotu wpisać: 3. STARA NAZWA"
    new = "Dz. 1. Rub. 1. Dane podmiotu wpisać: 3. NOWA NAZWA"
    ctx = context(
        {
            details_blob("2"): announcement("2", "0000654243", new, "2024-02-05"),
            details_blob("1"): announcement("1", "0000654243", old, "2003-02-05"),
        }
    )
    assert companies(ctx).iloc[0]["name"] == "NOWA NAZWA"


def test_an_older_announcement_still_fills_what_the_newer_left_out(context):
    seat = (
        "Dz. 1 Rub. 2 1. kraj POLSKA miejscowość KATOWICE 2. ulica X kod "
        "pocztowy 40-123"
    )
    rename = "Dz. 1. Rub. 1. Dane podmiotu wpisać: 3. NOWA NAZWA"
    ctx = context(
        {
            details_blob("2"): announcement("2", "0000654243", rename, "2024-02-05"),
            details_blob("1"): announcement("1", "0000654243", seat, "2003-02-05"),
        }
    )
    company = companies(ctx).iloc[0]
    assert company["name"] == "NOWA NAZWA"
    assert company["city"] == "katowice"


def test_every_company_is_sourced_to_the_monitor(context):
    ctx = context(
        {
            details_blob("1"): announcement(
                "1", "0000147672", WPIS_PIERWSZY, "2003-02-05"
            )
        }
    )
    assert companies(ctx).iloc[0]["sources"] == [
        {"source": "msig", "source_krs": "0000147672", "reason": None}
    ]


# ─── MSiGCrawled ─────────────────────────────────────────────


def test_crawled_lists_what_the_sweep_already_holds(context):
    ctx = context(
        {
            search_blob("0000654243"): {"list": []},
            details_blob("1"): announcement(
                "1", "0000654243", WPIS_KOLEJNY, "2024-02-05"
            ),
        }
    )
    pipeline = MSiGCrawled()
    frame = pipeline.process(ctx)
    pipeline.read_or_process = lambda _ctx: frame  # type: ignore[method-assign]
    assert pipeline.already_crawled(ctx) == ({"0000654243"}, {"1"})


def test_crawled_is_empty_before_the_first_sweep(context):
    pipeline = MSiGCrawled()
    pipeline.read_or_process = lambda _ctx: DataFrame()  # type: ignore[method-assign]
    assert pipeline.already_crawled(context({})) == (set(), set())
