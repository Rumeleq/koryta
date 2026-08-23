--
-- PostgreSQL database dump
--
-- Dumped from database version 15.10 (Debian 15.10-1.pgdg120+1)
-- Dumped by pg_dump version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)

\restrict aaaaFIXTURENONCEone

SET statement_timeout = 0;
SET client_encoding = 'UTF8';

CREATE TABLE public.umowa (
    id_umowy uuid NOT NULL,
    przedmiot_umowy text
);

CREATE TABLE public.strona_umowy (
    id bigint NOT NULL,
    id_umowy uuid NOT NULL
);

ALTER TABLE public.strona_umowy ALTER COLUMN id ADD GENERATED ALWAYS AS IDENTITY (
    SEQUENCE NAME public.strona_umowy_id_seq
    START WITH 1
);

CREATE TABLE public.wynik_wyszukiwania (
    id_umowy uuid NOT NULL
);

\unrestrict aaaaFIXTURENONCEone

--
-- PostgreSQL database dump complete
--

--
-- PostgreSQL database dump
--
-- Dumped from database version 15.10 (Debian 15.10-1.pgdg120+1)
-- Dumped by pg_dump version 16.14 (Ubuntu 16.14-0ubuntu0.24.04.1)

\restrict bbbbFIXTURENONCEtwo

COPY public.umowa (id_umowy, status_umowy, numer_umowy, brak_numeru_umowy, data_zawarcia_umowy, data_zakonczenia_umowy, umowa_na_czas_nieoznaczony, okres, przedmiot_umowy, niejawnosc_przedmiotu, wartosc_przedmiotu, niejawnosc_wartosci_przedmiotu, opis_wartosci_przedmiotu, finansowana_ze_srodkow, zmiany_umowy, data_publikacji, data_modyfikacji, zaimportowano) FROM stdin;
aaaaaaaa-0000-4000-8000-000000000001	Aktywna	NR/1/2026	f	2026-07-08	\N	f	5 dni	Zakup\tsprzętu\ndrugi wiersz \101	\N	1500.00	\N	\N	f	[{"komentarz": "Umowa zrealizowana", "dataZmiany": "20.07.2026", "rodzajZmiany": "Wygaśniecie umowy"}]	2026-07-24	2026-07-24	2026-07-24 15:16:35.886057+00
bbbbbbbb-0000-4000-8000-000000000002	Nieaktywna	\N	t	2026-06-01	2026-06-30	f	\N	Usługa niejawna	{"zakres": "Wartość umowy", "podstawa": "INNA", "komentarz": "test", "organLubOsobaWylaczajaca": "Dyrektor"}	1105491461.90	{"zakres": "Wartość umowy", "podstawa": "INNA", "komentarz": "test", "organLubOsobaWylaczajaca": "Dyrektor"}	opis	t	[{"komentarz": "bez daty", "dataZmiany": "2026/07/20", "rodzajZmiany": "Aneks"}]	2026-06-02	2026-06-03	2026-06-02 10:00:00.000000+00
cccccccc-0000-4000-8000-000000000003	Aktywna	NR/3/2026	f	2026-05-01	\N	t	\N	Umowa bez stron	\N	\N	\N	\N	\N	[]	2026-05-02	2026-05-02	2026-05-02 08:00:00.000000+00
\.

COPY public.strona_umowy (id, id_umowy, kraj, rodzaj, nazwa, nip, regon, imie, nazwisko, czy_konsorcjum, niejawnosc_strony, ulica, numer_nieruchomosci, numer_lokalu, wojewodztwo, powiat, gmina_miasto_dzielnica, miejscowosc, kod_pocztowy) FROM stdin;
20	aaaaaaaa-0000-4000-8000-000000000001	Polska	Przedsiębiorca	FUNDACJA TESTOWA	5361982599	52964557500011	\N	\N	f	\N	ul. Jagiellońska	61	\N	MAZOWIECKIE	legionowski	Legionowo	Legionowo	05-120
11	bbbbbbbb-0000-4000-8000-000000000002	Polska	Osoba fizyczna	\N	\N	\N	Jakub	Garnis	\N	{"zakres": "Wartość umowy", "podstawa": "INNA", "komentarz": "test", "organLubOsobaWylaczajaca": "Dyrektor"}	\N	\N	\N	\N	\N	\N	\N	\N
10	aaaaaaaa-0000-4000-8000-000000000001	Polska	JSFP	URZĄD MIASTA LEGIONOWO	5360015621	000524832	\N	\N	f	\N	ul. marsz. Józefa Piłsudskiego	41	\N	MAZOWIECKIE	legionowski	Legionowo	Legionowo	05-120
9	bbbbbbbb-0000-4000-8000-000000000002	Polska	JSFP	GMINA TESTOWA	1111111111	000000123	\N	\N	t	\N	\N	\N	\N	\N	\N	\N	\N	\N
\.

COPY public.wynik_wyszukiwania (id_umowy, nazwa, regon, data_zawarcia_umowy, data_zakonczenia_umowy, wartosc_przedmiotu_umowy, przedmiot_umowy, status_umowy, zaimportowano, detale_niedostepne, detale_blad, detale_niedostepne_od) FROM stdin;
aaaaaaaa-0000-4000-8000-000000000001	URZĄD MIASTA LEGIONOWO	000524832	2026-07-08	\N	1500.00	Zakup sprzętu	Aktywna	2026-07-24 15:16:35.886057+00	f	\N	\N
bbbbbbbb-0000-4000-8000-000000000002	GMINA TESTOWA	000000123	2026-06-01	2026-06-30	1105491461.90	Usługa niejawna	Nieaktywna	2026-06-02 10:00:00.000000+00	f	\N	\N
cccccccc-0000-4000-8000-000000000003	GMINA TRZECIA	000000999	2026-05-01	\N	\N	Umowa bez stron	Aktywna	2026-05-02 08:00:00.000000+00	f	\N	\N
dddddddd-0000-4000-8000-000000000004	GMINA WILKÓW	531412770	2026-07-23	2026-07-27	149.00	Switch zarządzalny 8 portów	Nieaktywna	2026-07-27 09:27:20.991038+00	t	Nie udało się wykonać GET /api-dp/v1/agreement/dddddddd-0000-4000-8000-000000000004 po 5 próbach	2026-08-04 14:40:28.911388+00
\.

\unrestrict bbbbFIXTURENONCEtwo

--
-- PostgreSQL database dump complete
--

--
-- Sequence value repaired from max(strona_umowy.id).
--
SELECT pg_catalog.setval('public.strona_umowy_id_seq', 20, true);
