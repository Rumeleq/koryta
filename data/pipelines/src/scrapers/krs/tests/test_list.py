import pandas as pd

from scrapers.krs.list import (
    company_from_rejestrio,
    get_teryt,
    normalize_city,
    parse_activity_from_api_krs,
)

# A random entry from api-krs data for a given company
TEST_DZIAL3 = {
    "przedmiotDzialalnosci": {
        "przedmiotPrzewazajacejDzialalnosci": [
            {
                "opis": "WYNAJEM I ZARZĄDZANIE NIERUCHOMOŚCIAMI WŁASNYMI LUB DZIERŻAWIONYMI",  # noqa: E501
                "kodDzial": "68",
                "kodKlasa": "20",
                "kodPodklasa": "Z",
            }
        ],
        "przedmiotPozostalejDzialalnosci": [
            {
                "opis": "ZARZĄDZANIE NIERUCHOMOŚCIAMI WYKONYWANE NA ZLECENIE",
                "kodDzial": "68",
                "kodKlasa": "32",
                "kodPodklasa": "Z",
            },
            {
                "opis": "KUPNO I SPRZEDAŻ NIERUCHOMOŚCI NA WŁASNY RACHUNEK",
                "kodDzial": "68",
                "kodKlasa": "10",
                "kodPodklasa": "Z",
            },
            {
                "opis": "ROZBIÓRKA I BURZENIE OBIEKTÓW BUDOWLANYCH",
                "kodDzial": "43",
                "kodKlasa": "11",
                "kodPodklasa": "Z",
            },
            {
                "opis": "PRZYGOTOWANIE TERENU POD BUDOWĘ",
                "kodDzial": "43",
                "kodKlasa": "12",
                "kodPodklasa": "Z",
            },
            {
                "opis": "ROBOTY BUDOWLANE ZWIĄZANE ZE WZNOSZENIEM BUDYNKÓW MIESZKALNYCH I NIEMIESZKALNYCH",  # noqa: E501
                "kodDzial": "41",
                "kodKlasa": "20",
                "kodPodklasa": "Z",
            },
            {
                "opis": "WYKONYWANIE INSTALACJI ELEKTRYCZNYCH",
                "kodDzial": "43",
                "kodKlasa": "21",
                "kodPodklasa": "Z",
            },
            {
                "opis": "WYKONYWANIE INSTALACJI WODNO-KANALIZACYJNYCH, CIEPLNYCH, GAZOWYCH I KLIMATYZACYJNYCH",  # noqa: E501
                "kodDzial": "43",
                "kodKlasa": "22",
                "kodPodklasa": "Z",
            },
            {
                "opis": "WYKONYWANIE POZOSTAŁYCH INSTALACJI BUDOWLANYCH",
                "kodDzial": "43",
                "kodKlasa": "29",
                "kodPodklasa": "Z",
            },
            {
                "opis": "POZOSTAŁE SPECJALISTYCZNE ROBOTY BUDOWLANE, GDZIE INDZIEJ NIESKLASYFIKOWANE",  # noqa: E501
                "kodDzial": "43",
                "kodKlasa": "99",
                "kodPodklasa": "Z",
            },
        ],
    },
    "wzmiankiOZlozonychDokumentach": {
        "wzmiankaOZlozeniuRocznegoSprawozdaniaFinansowego": [
            {"dataZlozenia": "01.10.2002", "zaOkresOdDo": "01.01.2001 DO 31.12.2001"},
            {"dataZlozenia": "11.07.2003", "zaOkresOdDo": "01.01.2002 DO 31.12.2002"},
            {"dataZlozenia": "10.08.2004", "zaOkresOdDo": "01.01.2003 DO 31.12.2003"},
            {
                "dataZlozenia": "29.04.2005",
                "zaOkresOdDo": "01.01.2004R. DO 31.12.2004R.",
            },
            {
                "dataZlozenia": "12.07.2006",
                "zaOkresOdDo": "01.01.2005 R. -31.12.2005 R.",
            },
            {
                "dataZlozenia": "28.06.2007",
                "zaOkresOdDo": "01.01.2006R. - 31.12.2006R.",
            },
            {"dataZlozenia": "15.09.2008", "zaOkresOdDo": "01.01.2007 - 31.12.2007"},
            {"dataZlozenia": "02.07.2009", "zaOkresOdDo": "01.01.2008-31.12.2008"},
            {"dataZlozenia": "25.06.2010", "zaOkresOdDo": "01.01.2009 - 31.12.2009"},
            {"dataZlozenia": "27.06.2011", "zaOkresOdDo": "01.01.2010 - 31.12.2010"},
            {"dataZlozenia": "29.06.2012", "zaOkresOdDo": "01.01.2011 - 31.12.2011"},
            {"dataZlozenia": "24.06.2013", "zaOkresOdDo": "01.01.2012 - 31.12.2012"},
            {
                "dataZlozenia": "09.07.2014",
                "zaOkresOdDo": "OD 01.01.2013 DO 31.12.2013",
            },
            {
                "dataZlozenia": "05.07.2015",
                "zaOkresOdDo": "OD 01.01.2014 DO 31.12.2014",
            },
            {
                "dataZlozenia": "29.06.2016",
                "zaOkresOdDo": "OD 01.01.2015 DO 31.12.2015",
            },
            {
                "dataZlozenia": "03.07.2017",
                "zaOkresOdDo": "OD 01.01.2016 DO 31.12.2016",
            },
            {
                "dataZlozenia": "05.07.2018",
                "zaOkresOdDo": "OD 01.01.2017 DO 31.12.2017",
            },
            {
                "dataZlozenia": "09.07.2019",
                "zaOkresOdDo": "OD 01.01.2018 DO 31.12.2018",
            },
            {
                "dataZlozenia": "21.07.2020",
                "zaOkresOdDo": "OD 01.01.2019 DO 31.12.2019",
            },
            {
                "dataZlozenia": "08.10.2021",
                "zaOkresOdDo": "OD 01.01.2020 DO 31.12.2020",
            },
            {
                "dataZlozenia": "27.09.2022",
                "zaOkresOdDo": "OD 01.01.2021 DO 31.12.2021",
            },
            {
                "dataZlozenia": "20.06.2023",
                "zaOkresOdDo": "OD 01.01.2022 DO 31.12.2022",
            },
            {
                "dataZlozenia": "04.07.2024",
                "zaOkresOdDo": "OD 01.01.2023 DO 31.12.2023",
            },
            {
                "dataZlozenia": "18.06.2025",
                "zaOkresOdDo": "OD 01.01.2024 DO 31.12.2024",
            },
        ],
        "wzmiankaOZlozeniuOpiniiBieglegoRewidentaSprawozdaniaZBadania": [
            {"zaOkresOdDo": "01.01.2002 DO 31.12.2002"},
            {"zaOkresOdDo": "01.01.2004R. DO 31.12.2004R."},
            {"zaOkresOdDo": "01.01.2005 R. -31.12.2005 R."},
            {"zaOkresOdDo": "01.01.2007 - 31.12.2007"},
            {"zaOkresOdDo": "01.01.2008-31.12.2008"},
        ],
        "wzmiankaOZlozeniuUchwalyPostanowieniaOZatwierdzeniuRocznegoSprawozdaniaFinansowego": [  # noqa: E501
            {"zaOkresOdDo": "01.01.2001 DO 31.12.2001"},
            {"zaOkresOdDo": "01.01.2002 DO 31.12.2002"},
            {"zaOkresOdDo": "01.01.2003 DO 31.12.2003"},
            {"zaOkresOdDo": "01.01.2004R. DO 31.12.2004R."},
            {"zaOkresOdDo": "01.01.2005 R. -31.12.2005 R."},
            {"zaOkresOdDo": "01.01.2006R. - 31.12.2006R."},
            {"zaOkresOdDo": "01.01.2007 - 31.12.2007"},
            {"zaOkresOdDo": "01.01.2008-31.12.2008"},
            {"zaOkresOdDo": "01.01.2009 - 31.12.2009"},
            {"zaOkresOdDo": "01.01.2010 - 31.12.2010"},
            {"zaOkresOdDo": "01.01.2011 - 31.12.2011"},
            {"zaOkresOdDo": "01.01.2012 - 31.12.2012"},
            {"zaOkresOdDo": "OD 01.01.2013 DO 31.12.2013"},
            {"zaOkresOdDo": "OD 01.01.2014 DO 31.12.2014"},
            {"zaOkresOdDo": "OD 01.01.2015 DO 31.12.2015"},
            {"zaOkresOdDo": "OD 01.01.2016 DO 31.12.2016"},
            {"zaOkresOdDo": "OD 01.01.2017 DO 31.12.2017"},
            {"zaOkresOdDo": "OD 01.01.2018 DO 31.12.2018"},
            {"zaOkresOdDo": "OD 01.01.2019 DO 31.12.2019"},
            {"zaOkresOdDo": "OD 01.01.2020 DO 31.12.2020"},
            {"zaOkresOdDo": "OD 01.01.2021 DO 31.12.2021"},
            {"zaOkresOdDo": "OD 01.01.2022 DO 31.12.2022"},
            {"zaOkresOdDo": "OD 01.01.2023 DO 31.12.2023"},
            {"zaOkresOdDo": "OD 01.01.2024 DO 31.12.2024"},
        ],
        "wzmiankaOZlozeniuSprawozdaniaZDzialalnosci": [
            {"zaOkresOdDo": "01.01.2001 DO 31.12.2001"},
            {"zaOkresOdDo": "01.01.2002 DO 31.12.2002"},
            {"zaOkresOdDo": "01.01.2003 DO 31.12.2003"},
            {"zaOkresOdDo": "01.01.2004R. DO 31.12.2004R."},
            {"zaOkresOdDo": "01.01.2005 R. -31.12.2005 R."},
            {"zaOkresOdDo": "01.01.2006R. - 31.12.2006R."},
            {"zaOkresOdDo": "01.01.2007 - 31.12.2007"},
            {"zaOkresOdDo": "01.01.2008-31.12.2008"},
            {"zaOkresOdDo": "01.01.2009 - 31.12.2009"},
            {"zaOkresOdDo": "01.01.2010 - 31.12.2010"},
            {"zaOkresOdDo": "01.01.2011 - 31.12.2011"},
            {"zaOkresOdDo": "01.01.2012 - 31.12.2012"},
            {"zaOkresOdDo": "OD 01.01.2013 DO 31.12.2013"},
            {"zaOkresOdDo": "OD 01.01.2014 DO 31.12.2014"},
            {"zaOkresOdDo": "OD 01.01.2015 DO 31.12.2015"},
            {"zaOkresOdDo": "OD 01.01.2016 DO 31.12.2016"},
            {"zaOkresOdDo": "OD 01.01.2017 DO 31.12.2017"},
            {"zaOkresOdDo": "OD 01.01.2018 DO 31.12.2018"},
            {"zaOkresOdDo": "OD 01.01.2019 DO 31.12.2019"},
            {"zaOkresOdDo": "OD 01.01.2020 DO 31.12.2020"},
            {"zaOkresOdDo": "OD 01.01.2021 DO 31.12.2021"},
            {"zaOkresOdDo": "OD 01.01.2022 DO 31.12.2022"},
            {"zaOkresOdDo": "OD 01.01.2023 DO 31.12.2023"},
            {"zaOkresOdDo": "OD 01.01.2024 DO 31.12.2024"},
        ],
    },
    "informacjaODniuKonczacymRokObrotowy": {
        "dzienKonczacyPierwszyRokObrotowy": "31.12.2001"
    },
}

TEST_DZIAL3_PARTIAL = {
    "przedmiotDzialalnosci": {
        "przedmiotPrzewazajacejDzialalnosci": [
            {
                "opis": "WYNAJEM I ZARZĄDZANIE NIERUCHOMOŚCIAMI WŁASNYMI LUB DZIERŻAWIONYMI",  # noqa: E501
                "kodDzial": "68",
                "kodKlasa": "20",
                "kodPodklasa": "Z",
            }
        ],
    }
}

# KRS: 0000000142
# UNIWERSYTECKI SZPITAL KLINICZNY W RADOMSKU
TEST_DZIAL3_STOWARZYSZENIE = {
    "celDzialaniaOrganizacji": {
        "celDzialania": "CELEM FUNKCJONOWANIA SZPITALA JEST ZACHOWANIE."
    }
}


def test_parse_activity_from_api_krs_company():
    activities = parse_activity_from_api_krs(TEST_DZIAL3)
    assert len(activities) == 10
    assert "68.20.Z" == activities[0]
    assert "68.32.Z" in activities


def test_parse_activity_from_api_krs_partial():
    activities = parse_activity_from_api_krs(TEST_DZIAL3_PARTIAL)
    assert len(activities) == 1


def test_parse_activity_from_api_krs_organization():
    activities = parse_activity_from_api_krs(TEST_DZIAL3_STOWARZYSZENIE)
    assert len(activities) == 0


#: A slice of the GeoNames postal code table, in the shape `PostalCodes`
#: leaves it: city lowercased, TERYT at gmina level.
POSTAL_CODES = pd.DataFrame(
    [
        # Warszawa spans hundreds of codes and one gmina.
        {"postal_code": "02-412", "city": "warszawa", "teryt": "146501"},
        {"postal_code": "04-128", "city": "warszawa", "teryt": "146501"},
        # Kudowa-Zdrój shares 57-350 with three hamlets in two other gminy, so
        # no code is dominant and only the spelling can settle it.
        {"postal_code": "57-350", "city": "kudowa-zdrój", "teryt": "020803"},
        {"postal_code": "57-350", "city": "karłów", "teryt": "020812"},
        {"postal_code": "57-350", "city": "pasterka", "teryt": "020812"},
        {"postal_code": "57-350", "city": "jerzykowice wielkie", "teryt": "020809"},
        # Krynica-Zdrój's code covers only its own gmina, whatever the row.
        {"postal_code": "33-380", "city": "krynica-zdrój", "teryt": "121007"},
        {"postal_code": "33-380", "city": "berest", "teryt": "121007"},
        {"postal_code": "33-380", "city": "czyrna", "teryt": "121007"},
        # Świdnik is five towns of that name in five gminy.
        {"postal_code": "21-047", "city": "świdnik", "teryt": "061701"},
        {"postal_code": "58-410", "city": "świdnik", "teryt": "020704"},
        {"postal_code": "34-606", "city": "świdnik", "teryt": "120708"},
    ]
)


def test_normalize_city_strips_the_registers_city_prefixes():
    assert normalize_city("M. NOWY SĄCZ") == "nowy sącz"
    assert normalize_city("M.ST. WARSZAWA") == "warszawa"
    assert normalize_city("Miasto Stołeczne Warszawa") == "warszawa"
    # Not a prefix: dropping a bare "m" would make this "iechów".
    assert normalize_city("MIECHÓW") == "miechów"


def test_normalize_city_settles_the_hyphen():
    assert normalize_city("Bielsko- Biała") == "bielsko-biała"
    assert normalize_city("KĘDZIERZYN - KOŹLE") == "kędzierzyn-koźle"
    assert normalize_city("Kudowa Zdrój") == "kudowa-zdrój"
    assert normalize_city("jastrzębie zdrój") == "jastrzębie-zdrój"


def test_get_teryt_prefers_the_exact_row():
    assert get_teryt(POSTAL_CODES, "warszawa", "02-412") == "146501"
    # Even against a `fallback`, which is coarser here.
    assert get_teryt(POSTAL_CODES, "warszawa", "02-412", fallback="1465") == "146501"


def test_get_teryt_matches_on_the_normalized_name():
    assert get_teryt(POSTAL_CODES, "KUDOWA ZDRÓJ", "57-350") == "020803"


def test_get_teryt_falls_back_to_the_registered_seat():
    # Świdnik with no postal code is unresolvable from the table alone: five
    # towns of that name, none of them dominant.
    assert get_teryt(POSTAL_CODES, "świdnik", None) == ""
    assert get_teryt(POSTAL_CODES, "świdnik", None, fallback="061701") == "061701"


def test_get_teryt_takes_a_coarse_seat_only_once_the_table_is_out():
    """An entry that named a powiat TERYT has never had, or none at all.

    The register contradicted itself, so it loses to the table wherever the
    table has an answer - and is still worth returning where it does not.
    """
    # The table places Kudowa-Zdrój exactly; a bare województwo does not.
    assert get_teryt(POSTAL_CODES, "kudowa-zdrój", "99-999", fallback="02") == "020803"
    assert get_teryt(POSTAL_CODES, "gdzieś", "99-999", fallback="02") == "02"


def test_get_teryt_falls_back_to_the_postal_code_alone():
    # "Warszawa-Włochy" is a district: no table names it, every table has
    # its postal code.
    assert get_teryt(POSTAL_CODES, "warszawa-włochy", "04-128") == "146501"
    # A code all of whose rows agree resolves even where the name does not.
    assert get_teryt(POSTAL_CODES, "krynica", "33-380") == "121007"


def test_get_teryt_falls_back_to_the_city_alone():
    assert get_teryt(POSTAL_CODES, "kudowa-zdrój", "99-999") == "020803"


def test_get_teryt_gives_up_on_an_address_it_cannot_place():
    assert get_teryt(POSTAL_CODES, "", "") == ""


def test_company_from_rejestrio_reads_the_postal_code_it_is_given():
    """rejestr.io names the field `kod`, and it is the only key on the table."""
    company = company_from_rejestrio(
        {
            "numery": {"krs": "0000000001"},
            "nazwy": {"skrocona": "SPÓŁKA"},
            "adres": {"miejscowosc": "Świdnik", "kod": "21-047"},
        },
        POSTAL_CODES,
    )
    assert company.teryt_code == "061701"
