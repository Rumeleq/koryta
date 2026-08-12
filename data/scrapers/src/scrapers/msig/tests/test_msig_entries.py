"""Parsing announcements, against text taken verbatim from the Monitor."""

from scrapers.msig.entries import Action, normalize, parse_body

# MSiG 25/2024 poz. 70629, KRS 0000654243. A shareholder replaced, another's
# holding amended in place, and a board member struck off.
WPIS_KOLEJNY = (
    "W dniu 26.01.2024 dokonano wpisu do rejestru KRS  nr 17 następującej "
    "treści:  Dz.  1.  Rub.  7.  Dane wspólników wykreślić:  1  1.  GOSIEWSKI "
    "2.  STANISŁAW ANTONI  3. 69032811497 5. 50 UDZIAŁÓW O ŁĄCZNEJ WARTOŚCI "
    "2.500,,00 ZŁ 6. NIE 2 (dla pozycji: 1. TOBOROWICZ 2. PAWEŁ ANDRZEJ "
    "3. 70022512515) 5. 50  UDZIAŁÓW O ŁĄCZNEJ WARTOŚCI 2.500,,00 ZŁ  "
    "wpisać: 5. 90 UDZIAŁÓW O ŁĄCZNEJ WARTOŚCI 4.500,00 ZŁ wykreślić: 6. NIE "
    "wpisać: 6. NIE  3 1. OLEJNIK 2. MARZENA 3. 85120206002 5. 10  UDZIAŁÓW "
    "O ŁĄCZNEJ WARTOŚCI 500,00 ZŁ 6. NIE    Dz. 2. Rub. 1. Organ uprawniony "
    "do reprezentacji podmiotu 1 (dla pozycji: 1. ZARZĄD SPÓŁKI)  PRub. Dane "
    "osób wchodzących w skład organu  wykreślić: 1 1. GOSIEWSKI 2. STANISŁAW "
    "ANTONI  3. 69032811497 5. CZŁONEK ZARZĄDU 6. NIE"
)

# MSiG 12/2003 poz. 12001, KRS 0000147672. A first entry: no wpisać/wykreślić
# markers at all, and the function in field 4 rather than field 5.
WPIS_PIERWSZY = (
    "W dniu 21.01.2003 dokonano wpisu do rejestru KRS nr 1 następującej "
    "treści:  Dz. 1 Rub. 1. spółka jawna 2. 270616654 3. AGENCJA GOSPODARCZA "
    "COMMERCIUM SZPILMAN SZYSZKA, SPÓŁKA JAWNA 4. nazwa rejestru RHA 5. NIE "
    "Rub. 2 1. kraj POLSKA województwo ŚLĄSKIE powiat M. KATOWICE gmina "
    "M. KATOWICE miejscowość KATOWICE 2. ulica CZERWIŃSKIEGO nr domu 6 nr "
    "lokalu 317 kod pocztowy 40-123 poczta KATOWICE kraj POLSKA "
    "Rub. 7 Wspólnicy 1. SZYSZKA 2. WENANCJUSZ STANISŁAW 3. 36050103479 "
    "5. TAK 6. NIE 7. NIE 8. NIE 2 1. SZPILMAN SZYSZKA 2. LUDMIŁA "
    "3. 45012803962 5. TAK 6. NIE 7. NIE 8. NIE  Dz. 2 Rub. 1 Organ "
    "uprawniony do reprezentacji podmiotu 1. WSPÓLNICY REPREZENTUJĄCY SPÓŁKĘ "
    "2. KAŻDY WSPÓLNIK MA PRAWO PROWADZENIA SPRAW SPÓŁKI PRub. Dane osób "
    "wchodzących w skład organu 1. SZYSZKA 2. WENANCJUSZ STANISŁAW "
    "3. 36050103479 4. WSPÓLNIK 5. NIE"
)


def entries_of(text):
    return parse_body(text).entries


def find(text, dzial, rubryka, action=None):
    return [
        entry
        for entry in entries_of(text)
        if entry.dzial == dzial
        and entry.rubryka == rubryka
        and (action is None or entry.action is action)
    ]


def test_header_gives_the_date_the_court_made_the_entry():
    body = parse_body(WPIS_KOLEJNY)
    assert body.entry_date == "2024-01-26"
    assert body.entry_number == 17


def test_body_without_a_header_still_parses():
    assert parse_body("Dz. 2. Rub. 3. Prokurenci wpisać: 1 1. NOWAK").entry_date is None


def test_empty_body():
    assert parse_body(None).entries == []
    assert parse_body("").entries == []


def test_struck_shareholder_keeps_its_fields():
    struck = find(WPIS_KOLEJNY, 1, 7, Action.REMOVE)[0]
    assert struck.action is Action.REMOVE
    assert struck.position == 1
    assert struck.fields[1] == "GOSIEWSKI"
    assert struck.fields[2] == "STANISŁAW ANTONI"
    assert struck.fields[3] == "69032811497"


def test_added_shareholder_is_separated_from_the_struck_one():
    """The two are told apart by the ordinal between them, not by punctuation."""
    added = [e for e in find(WPIS_KOLEJNY, 1, 7, Action.ADD) if e.fields.get(1)]
    assert [e.fields[1] for e in added] == ["OLEJNIK"]
    assert added[0].position == 3


def test_dla_pozycji_is_a_reference_not_an_appointment():
    referenced = find(WPIS_KOLEJNY, 1, 7, Action.REFERENCE)
    assert [e.fields[1] for e in referenced] == ["TOBOROWICZ"]
    assert referenced[0].position == 2


def test_amendments_after_a_reference_carry_no_name():
    """So they cannot be mistaken for somebody joining or leaving."""
    for entry in find(WPIS_KOLEJNY, 1, 7):
        if entry.action is Action.REFERENCE:
            continue
        if entry.fields.get(1) in (None, "OLEJNIK", "GOSIEWSKI"):
            continue
        raise AssertionError(f"unexpected name in {entry}")


def test_subrubryka_scopes_the_people_under_an_organ():
    board = find(WPIS_KOLEJNY, 2, 1, Action.REMOVE)
    assert board[0].subrubryka == "Dane osób wchodzących w skład organu"
    assert board[0].fields[5] == "CZŁONEK ZARZĄDU"


def test_first_entry_has_no_action_markers():
    partners = find(WPIS_PIERWSZY, 1, 7)
    assert [e.action for e in partners] == [Action.STATE, Action.STATE]
    assert [e.fields[1] for e in partners] == ["SZYSZKA", "SZPILMAN SZYSZKA"]


def test_first_entry_starts_a_new_item_when_a_field_number_repeats():
    """The first item under a rubryka is written without its ordinal."""
    partners = find(WPIS_PIERWSZY, 1, 7)
    assert partners[0].position is None
    assert partners[1].position == 2


def test_rubryka_name_survives_the_typesetting():
    assert find(WPIS_KOLEJNY, 1, 7)[0].rubryka_name == "Dane wspólników"
    assert find(WPIS_PIERWSZY, 1, 7)[0].rubryka_name == "Wspólnicy"


def test_dates_inside_a_field_are_not_read_as_field_numbers():
    body = (
        "Dz. 3. Rub. 2. Wzmianki o złożonych dokumentach wpisać: 1 1. data "
        "złożenia 25.01.2024 okres OD 01.01.2022 DO 31.12.2022"
    )
    entry = parse_body(body).entries[0]
    assert entry.fields[1] == (
        "data złożenia 25.01.2024 okres OD 01.01.2022 DO 31.12.2022"
    )


def test_amounts_inside_a_field_are_not_read_as_field_numbers():
    struck = find(WPIS_KOLEJNY, 1, 7, Action.REMOVE)[0]
    assert struck.fields[5] == "50 UDZIAŁÓW O ŁĄCZNEJ WARTOŚCI 2.500,,00 ZŁ"


def test_dla_pozycji_without_a_colon():
    """How entries from before roughly 2010 write it."""
    body = "Dz. 2 Rub. 1 Organ uprawniony 1 (dla pozycji 1. ZARZĄD) PRub. Dane osób"
    entry = parse_body(body).entries[0]
    assert entry.action is Action.REFERENCE
    assert entry.fields == {1: "ZARZĄD"}


# ─── the page furniture ──────────────────────────────────────


def test_running_head_is_dropped():
    assert normalize(
        "1. KOWALSKI XV. WPISY DO KRAJOWEGO REJESTRU SĄDOWEGO 5 LUTEGO 2024 R. "
        "2. JAN"
    ) == "1. KOWALSKI 2. JAN"


def test_hyphenated_word_is_rejoined_across_the_page_break():
    assert normalize(
        "Uprawnieni do reprezentowa-XV. WPISY DO KRAJOWEGO REJESTRU SĄDOWEGO "
        "12 WRZEŚNIA 2018 R. nia spółki"
    ) == "Uprawnieni do reprezentowania spółki"


def test_subscriber_watermark_is_dropped_with_the_head():
    assert normalize(
        "5. TAK WPISY DO KRAJOWEGO REJESTRU SĄDOWEGO 15 CZERWCA 2010 R."
        "Odbiorca: * ID: ZAMO_12_009632_114_001 6. NIE"
    ) == "5. TAK 6. NIE"


def test_column_breaks_inside_a_name_are_one_space():
    assert normalize("1. BIELECKA  JAKUBIAK 2. PAULINA NINA") == (
        "1. BIELECKA JAKUBIAK 2. PAULINA NINA"
    )
