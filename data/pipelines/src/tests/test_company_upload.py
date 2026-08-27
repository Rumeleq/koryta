"""What `submit_company` sends to `/api/ingest/company`.

The uploader takes payloads from two different producers and they carry
ownership in two different shapes, which is the whole reason this needs a test:

  `CompaniesPayloads` resolves the register's shareholder list itself and emits
    `owners` (KRS numbers) and `owner_teryts` (TERYT codes) already worked out.

  the `Companies` pipeline, read directly when a person's ingest names a company
    the site does not have yet, emits `parents` - a list of `{krs, teryt}` - and
    no `owners` at all.

`submit_company` used to derive `owners`/`owner_teryts` from `parents`
unconditionally, so the first shape had both fields overwritten with empty
lists. 3,928 companies uploaded, every one reported OK, and not one ownership
edge was written.
"""

from unittest.mock import MagicMock

from uploader import CompanyUploader


def uploader() -> CompanyUploader:
    """A CompanyUploader without its constructor, which performs a browser login."""
    instance = object.__new__(CompanyUploader)
    instance.args = MagicMock(endpoint="http://localhost:3000")
    instance.headers = {}
    instance.submit_payload = MagicMock(return_value=None)
    return instance


def sent(instance: CompanyUploader) -> dict:
    return instance.submit_payload.call_args[0][1]  # type: ignore[attr-defined]


def test_owners_already_worked_out_by_the_pipeline_are_kept():
    instance = uploader()
    instance.submit_company(
        "0000076705",
        {
            "krs": "0000076705",
            "name": "PKP SKM w Trojmiescie",
            "owners": ["0000019193"],
            "owner_teryts": ["2261011", "22"],
        },
    )
    payload = sent(instance)
    assert payload["owners"] == ["0000019193"]
    assert payload["owner_teryts"] == ["2261011", "22"]


def test_an_empty_owner_list_from_the_pipeline_is_an_answer():
    """Not "look for parents instead" - the pipeline found no owner."""
    instance = uploader()
    instance.submit_company(
        "0000000001",
        {
            "krs": "0000000001",
            "name": "Nobody's",
            "owners": [],
            "owner_teryts": [],
            "parents": [{"krs": "0000019193", "teryt": None}],
        },
    )
    payload = sent(instance)
    assert payload["owners"] == []
    assert payload["owner_teryts"] == []


def test_parents_are_split_when_the_payload_has_no_owners():
    """The `Companies` shape: a company created because somebody works there."""
    instance = uploader()
    instance.submit_company(
        "0000076705",
        {
            "krs": "0000076705",
            "name": "PKP SKM w Trojmiescie",
            "parents": [
                {"krs": "0000019193", "teryt": None},
                {"krs": None, "teryt": "2261011"},
                {"krs": None, "teryt": "22"},
            ],
        },
    )
    payload = sent(instance)
    assert payload["owners"] == ["0000019193"]
    assert payload["owner_teryts"] == ["2261011", "22"]
