"""Tests for ArticleAnalyzed fact deduplication (within + between articles)."""

from scrapers.article.pipelines.article_analyzed_pipeline import (
    _canonical_org,
    _canonical_party,
    _canonical_role,
    _collapse_between_articles,
    _dedup_facts_for_article,
    _fact_key,
    _fact_matches_koryta,
    _fact_person,
    _koryta_name_by_id,
    _person_ids_by_url,
    _strip_and_date_fact,
)


def employment(person, org, role, **extra):
    fact = {
        "fact_type": "employment",
        "person": person,
        "organization": org,
        "role": role,
    }
    fact.update(extra)
    return fact


def party(person, party, **extra):
    fact = {"fact_type": "party_membership", "person": person, "party": party}
    fact.update(extra)
    return fact


# --- _canonical_party ----------------------------------------------------- #


def test_canonical_party_aliases_fold():
    assert _canonical_party("PiS") == "Prawo i Sprawiedliwość"
    assert _canonical_party("Prawo i Sprawiedliwość") == "Prawo i Sprawiedliwość"
    assert _canonical_party("PSL-Koalicja Polska") == "Polskie Stronnictwo Ludowe"
    assert _canonical_party("po") == "Platforma Obywatelska"


def test_canonical_party_unknown_passes_through():
    assert _canonical_party("Polska 2050") == "polska 2050"


def test_canonical_party_empty():
    assert _canonical_party(None) == ""
    assert _canonical_party("") == ""


# --- _canonical_org -------------------------------------------------------- #


def test_canonical_org_folds_legal_suffix():
    assert _canonical_org("KGHM Polska Miedź S.A.") == "kghm polska miedź"
    assert _canonical_org("Tauron Polska Energia SA") == "tauron polska energia"


def test_canonical_org_folds_rp_suffix():
    assert _canonical_org("Sejm RP") == "sejm"
    assert _canonical_org("Sejm Rzeczypospolitej Polskiej") == "sejm"
    assert _canonical_org("Senat") == "senat"


def test_canonical_org_folds_party_alias_in_org_slot():
    assert _canonical_org("PSL") == "polskie stronnictwo ludowe"
    assert _canonical_org("Polskie Stronnictwo Ludowe") == "polskie stronnictwo ludowe"


def test_canonical_org_folds_ministry_rename():
    assert _canonical_org("Ministerstwo Klimatu") == (
        "ministerstwo klimatu i środowiska"
    )
    assert _canonical_org("Ministerstwo Środowiska") == (
        "ministerstwo klimatu i środowiska"
    )


def test_canonical_org_folds_brand_variant():
    assert _canonical_org("PKN Orlen") == "orlen"
    assert _canonical_org("Orlen") == "orlen"


# --- _canonical_role ------------------------------------------------------- #


def test_canonical_role_folds_gender_and_form():
    assert _canonical_role("minister") == "minister"
    assert _canonical_role("ministra") == "minister"
    assert _canonical_role("poseł") == "poseł"
    assert _canonical_role("posłanka") == "poseł"
    assert _canonical_role("prezes zarządu") == "prezes"
    assert _canonical_role("szefowa") == "szef"


# --- _fact_key ------------------------------------------------------------ #


def test_fact_key_is_exact_on_entity_fields():
    a = _fact_key(employment("Jan Kowalski", "Orlen", "prezes"))
    b = _fact_key(employment("Jan Kowalski", "Orlen", "prezes"))
    assert a == b


def test_fact_key_ignores_justification_and_date():
    a = _fact_key(
        employment(
            "Jan Kowalski", "Orlen", "prezes", justification="x", date="2020-01-01"
        )
    )
    b = _fact_key(
        employment(
            "Jan Kowalski", "Orlen", "prezes", justification="y", date="2021-01-01"
        )
    )
    assert a == b


def test_fact_key_distinguishes_roles():
    a = _fact_key(employment("Jan Kowalski", "Orlen", "prezes"))
    b = _fact_key(employment("Jan Kowalski", "Orlen", "wiceprezes"))
    assert a != b


def test_fact_key_folds_party_aliases():
    a = _fact_key(party("Jan Kowalski", "PiS"))
    b = _fact_key(party("Jan Kowalski", "Prawo i Sprawiedliwość"))
    assert a == b


def test_fact_key_is_whitespace_and_case_insensitive():
    a = _fact_key(employment("  Jan Kowalski ", " Orlen ", "prezes"))
    b = _fact_key(employment("jan kowalski", "orlen", "prezes"))
    assert a == b


def test_fact_key_folds_org_aliases():
    a = _fact_key(employment("Jan Kowalski", "Sejm", "minister"))
    b = _fact_key(
        employment("Jan Kowalski", "Sejm Rzeczypospolitej Polskiej", "minister")
    )
    c = _fact_key(employment("Jan Kowalski", "PKN Orlen", "prezes"))
    d = _fact_key(employment("Jan Kowalski", "Orlen", "prezes"))
    assert a == b
    assert c == d


def test_fact_key_folds_role_gender():
    a = _fact_key(employment("Jan Kowalski", "Sejm", "posłanka"))
    b = _fact_key(employment("Jan Kowalski", "Sejm", "poseł"))
    assert a == b


def test_fact_key_splits_same_name_by_person_id():
    # Same literal name, different koryta ids -> different keys (two different
    # "Piotr Woźniak" people must not dedupe into one).
    a = _fact_key(
        employment("Piotr Woźniak", "Orlen", "prezes"),
        person_name="piotr woźniak",
        person_id="idA",
    )
    b = _fact_key(
        employment("Piotr Woźniak", "Orlen", "prezes"),
        person_name="piotr woźniak",
        person_id="idB",
    )
    assert a != b


def test_fact_key_same_name_same_id_matches():
    a = _fact_key(
        employment("Piotr Woźniak", "Orlen", "prezes"),
        person_name="piotr woźniak",
        person_id="idA",
    )
    b = _fact_key(
        employment("Piotr Woźniak", "Orlen", "prezes"),
        person_name="piotr woźniak",
        person_id="idA",
    )
    assert a == b


def test_fact_key_default_person_tuple_is_empty_id():
    key = _fact_key(employment("Jan Kowalski", "Orlen", "prezes"))
    assert key[1] == ("jan kowalski", "")


def test_dedup_facts_for_article_splits_same_name_by_resolved_ids():
    first_seen = {}
    evidence = {}
    facts = [
        employment("Piotr Woźniak", "Orlen", "prezes"),
        employment("Piotr Woźniak", "Orlen", "prezes"),
    ]
    # Both articles' facts are about the SAME person_id -> only one survives.
    triaged = _dedup_facts_for_article(
        "a.pl/x", facts, first_seen, evidence, person_ids={"piotr woźniak": "idA"}
    )
    assert len(triaged) == 1


def test_dedup_facts_for_article_keeps_different_ids_apart():
    first_seen = {}
    evidence = {}
    pw = employment("Piotr Woźniak", "Orlen", "prezes")
    t1 = _dedup_facts_for_article(
        "a.pl/1", [pw], first_seen, evidence, person_ids={"piotr woźniak": "idA"}
    )
    t2 = _dedup_facts_for_article(
        "b.pl/2", [pw], first_seen, evidence, person_ids={"piotr woźniak": "idB"}
    )
    out1 = _collapse_between_articles(
        "a.pl/1", t1, first_seen, evidence, keep_evidence=True
    )
    out2 = _collapse_between_articles(
        "b.pl/2", t2, first_seen, evidence, keep_evidence=True
    )
    assert len(out1) == 1
    assert len(out2) == 1


def test_hypothetical_same_name_two_people_id_split_end_to_end():
    """Two different koryta people with the SAME name and the SAME fact must
    stay separate, while each person's copies across articles still collapse.

    Simulates the pipeline flow over several articles (per-article mention
    resolution -> _dedup_facts_for_article -> _collapse_between_articles).
    """
    first_seen = {}
    evidence = {}
    pending = {}

    # As in process(): every article is triaged (mention-resolved + within-dup
    # collapsed) FIRST, then the between-article collapse runs over all of them
    # so each fact's evidence reflects the whole corpus.
    for url, person_ids in [
        ("a.pl/1", {"piotr woźniak": "idA"}),
        ("b.pl/2", {"piotr woźniak": "idB"}),
        ("c.pl/3", {"piotr woźniak": "idA"}),
    ]:
        triaged = _dedup_facts_for_article(
            url,
            [
                employment("Piotr Woźniak", "Orlen", "prezes"),
                employment("Piotr Woźniak", "Orlen", "prezes"),
            ],  # within-article dup
            first_seen,
            evidence,
            person_ids=person_ids,
        )
        pending[url] = triaged

    out_a1 = _collapse_between_articles(
        "a.pl/1", pending["a.pl/1"], first_seen, evidence, keep_evidence=True
    )
    out_b = _collapse_between_articles(
        "b.pl/2", pending["b.pl/2"], first_seen, evidence, keep_evidence=True
    )
    out_a2 = _collapse_between_articles(
        "c.pl/3", pending["c.pl/3"], first_seen, evidence, keep_evidence=True
    )

    # A and B are DIFFERENT people -> both facts survive (not merged).
    assert len(out_a1) == 1
    assert len(out_b) == 1
    # Person A's second article collapses into A's first (same id).
    assert out_a2 == []
    assert out_a1[0]["evidence"] == ["a.pl/1", "c.pl/3"]
    assert out_b[0]["evidence"] == ["b.pl/2"]


# --- _strip_and_date_fact ------------------------------------------------- #


def test_strip_and_date_fact_drops_verifier_fields():
    fact = _strip_and_date_fact(
        {
            "fact_type": "employment",
            "person": "Jan Kowalski",
            "verified": True,
            "verification_verdict": "correct",
            "verification_reason": "ok",
        },
        "2020-01-01",
    )
    assert "verified" not in fact
    assert "verification_verdict" not in fact
    assert "verification_reason" not in fact
    assert fact["date"] == "2020-01-01"


# --- _dedup_facts_for_article --------------------------------------------- #


def test_within_article_duplicates_kept_once():
    first_seen = {}
    evidence = {}
    facts = [
        employment("Jan Kowalski", "Orlen", "prezes"),
        employment("Jan Kowalski", "Orlen", "prezes"),
        employment("Jan Kowalski", "Orlen", "wiceprezes"),
    ]
    triaged = _dedup_facts_for_article("a.pl/x", facts, first_seen, evidence)
    assert len(triaged) == 2


def test_first_seen_and_evidence_recorded():
    first_seen = {}
    evidence = {}
    _dedup_facts_for_article(
        "a.pl/x",
        [employment("Jan Kowalski", "Orlen", "prezes")],
        first_seen,
        evidence,
    )
    key = _fact_key(employment("Jan Kowalski", "Orlen", "prezes"))
    assert first_seen[key] == "a.pl/x"
    assert evidence[key] == ["a.pl/x"]


# --- _collapse_between_articles -------------------------------------------- #


def test_between_articles_keeps_first_evidence():
    first_seen = {}
    evidence = {}
    t1 = _dedup_facts_for_article(
        "a.pl/1",
        [employment("Jan Kowalski", "Orlen", "prezes")],
        first_seen,
        evidence,
    )
    t2 = _dedup_facts_for_article(
        "b.pl/2",
        [employment("Jan Kowalski", "Orlen", "prezes")],
        first_seen,
        evidence,
    )

    out1 = _collapse_between_articles(
        "a.pl/1", t1, first_seen, evidence, keep_evidence=True
    )
    out2 = _collapse_between_articles(
        "b.pl/2", t2, first_seen, evidence, keep_evidence=True
    )

    assert len(out1) == 1
    assert out1[0]["evidence"] == ["a.pl/1", "b.pl/2"]
    assert out2 == []


def test_collapse_drops_evidence_by_default():
    first_seen = {}
    evidence = {}
    t1 = _dedup_facts_for_article(
        "a.pl/1", [employment("Jan Kowalski", "Orlen", "prezes")], first_seen, evidence
    )
    _dedup_facts_for_article(
        "b.pl/2", [employment("Jan Kowalski", "Orlen", "prezes")], first_seen, evidence
    )
    out1 = _collapse_between_articles("a.pl/1", t1, first_seen, evidence)
    assert len(out1) == 1
    assert "evidence" not in out1[0]


def test_distinct_facts_all_kept():
    first_seen = {}
    evidence = {}
    t1 = _dedup_facts_for_article(
        "a.pl/1",
        [
            employment("Jan Kowalski", "Orlen", "prezes"),
            employment("Anna Nowak", "Orlen", "prezes"),
        ],
        first_seen,
        evidence,
    )
    out1 = _collapse_between_articles(
        "a.pl/1", t1, first_seen, evidence, keep_evidence=True
    )
    assert len(out1) == 2
    assert all("evidence" in f for f in out1)


def test_collapse_drops_evidence_by_default_keeps_distinct():
    first_seen = {}
    evidence = {}
    t1 = _dedup_facts_for_article(
        "a.pl/1",
        [
            employment("Jan Kowalski", "Orlen", "prezes"),
            employment("Anna Nowak", "Orlen", "prezes"),
        ],
        first_seen,
        evidence,
    )
    out1 = _collapse_between_articles("a.pl/1", t1, first_seen, evidence)
    assert len(out1) == 2
    assert all("evidence" not in f for f in out1)


# --- _person_ids_by_url / _fact_person -------------------------------------- #

_MENTIONS_JSONL = """\
{"url": "a.pl/1", "person": "Piotr Woźniak", "person_id": "idA", "verdict": "yes"}
{"url": "a.pl/1", "person": "Jan Nowak", "person_id": "idJ", "verdict": "no"}
{"url": "b.pl/2", "person": "Piotr Woźniak", "person_id": "idB", "verdict": "yes"}
{"url": "b.pl/2", "person": "Anna Lis", "person_id": "idL", "verdict": "yes"}
{"url": "c.pl/3", "person": "Piotr Wozniak", "person_id": "idC", "verdict": "yes"}
"""


def test_person_ids_by_url_keeps_yes_only_and_normalizes(tmp_path):
    path = tmp_path / "mentions.jsonl"
    path.write_text(_MENTIONS_JSONL, encoding="utf-8")
    by_url = _person_ids_by_url(path)
    # 'no' verdicts drop; names are lowercased/whitespace-collapsed.
    assert by_url["a.pl/1"] == {"piotr woźniak": "idA"}
    assert by_url["b.pl/2"] == {"piotr woźniak": "idB", "anna lis": "idL"}
    # No diacritic folding: "Piotr Wozniak" normalizes to its own spelling.
    assert by_url["c.pl/3"] == {"piotr wozniak": "idC"}


def test_person_ids_by_url_missing_file(tmp_path):
    assert _person_ids_by_url(tmp_path / "missing.jsonl") == {}


def test_koryta_name_by_id_reads_person_koryta(tmp_path):
    path = tmp_path / "person_koryta.jsonl"
    path.write_text(
        '{"id": "idA", "full_name": "Piotr Woźniak"}\n'
        '{"id": "idB", "full_name": "Anna Nowak"}\n',
        encoding="utf-8",
    )
    assert _koryta_name_by_id(path) == {"idA": "Piotr Woźniak", "idB": "Anna Nowak"}


def test_koryta_name_by_id_missing_file(tmp_path):
    assert _koryta_name_by_id(tmp_path / "missing.jsonl") == {}


def test_fact_matches_koryta_by_name():
    names = {"idA": "Piotr Woźniak", "idB": "Jan Kowalski"}
    fact = employment("Piotr Woźniak", "Orlen", "prezes")
    assert _fact_matches_koryta(fact, "a.pl/1", ["idA"], names)
    assert not _fact_matches_koryta(fact, "a.pl/1", ["idB"], names)
    # Case/whitespace insensitive, diacritics folded.
    fact2 = employment(" PIOTR WOŹNIAK  ", "Orlen", "prezes")
    assert _fact_matches_koryta(fact2, "a.pl/1", ["idA"], names)


def test_fact_matches_koryta_subject_for_relation():
    names = {"idA": "Anna Nowak"}
    fact = {
        "fact_type": "personal_relation",
        "subject": "Anna Nowak",
        "object": "Jan Kowalski",
        "relation": "żona",
    }
    assert _fact_matches_koryta(fact, "a.pl/1", ["idA"], names)
    # No person/subject, or no ids -> not matched.
    assert not _fact_matches_koryta(
        {"fact_type": "employment"}, "a.pl/1", ["idA"], names
    )
    assert not _fact_matches_koryta(fact, "a.pl/1", [], names)


def test_fact_person_uses_person_then_subject():
    assert _fact_person(
        employment("Jan Kowalski", "Orlen", "prezes"), {"jan kowalski": "k1"}
    ) == ("jan kowalski", "k1")
    # personal_relation names the subject as `subject`.
    assert _fact_person(
        {"fact_type": "personal_relation", "subject": "Anna Nowak"},
        {"anna nowak": "k2"},
    ) == ("anna nowak", "k2")
    # Unconfirmed person -> literal name kept, empty id.
    assert _fact_person(employment("Jan Kowalski", "Orlen", "prezes"), {}) == (
        "jan kowalski",
        "",
    )
