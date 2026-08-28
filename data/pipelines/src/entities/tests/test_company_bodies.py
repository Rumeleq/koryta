"""Tests for the supervisory-organ mapping.

The legal forms are the register's own spelling, copied from `formaPrawna` in
the api-krs response for the named KRS number, so an entry can be re-checked
against the register.
"""

import unittest

from entities.company_bodies import (
    RADA_SPOLECZNA,
    SUPERVISORY_BODY_BY_FORM,
    supervisory_body,
)
from entities.company_categories import SPZOZ


class TestSupervisoryBody(unittest.TestCase):
    def test_an_spzoz_is_supervised_by_a_rada_spoleczna(self):
        # KRS 0000079907, SP ZOZ Szpital Specjalistyczny nr I w Bytomiu: the
        # register's dzial2.organNadzoru is named "RADA SPOŁECZNA".
        self.assertEqual(supervisory_body(SPZOZ), RADA_SPOLECZNA)

    def test_a_spolka_says_nothing(self):
        self.assertEqual(supervisory_body("SPÓŁKA AKCYJNA"), "")
        self.assertEqual(
            supervisory_body("SPÓŁKA Z OGRANICZONĄ ODPOWIEDZIALNOŚCIĄ"), ""
        )

    def test_an_unread_form_says_nothing(self):
        # The safe direction: a company whose form nobody parsed keeps counting
        # its supervisory seats as employment.
        self.assertEqual(supervisory_body(None), "")
        self.assertEqual(supervisory_body(""), "")
        self.assertEqual(supervisory_body("   "), "")

    def test_the_form_is_compared_case_insensitively_and_whole(self):
        self.assertEqual(supervisory_body(SPZOZ.lower()), RADA_SPOLECZNA)
        self.assertEqual(supervisory_body(f"  {SPZOZ}  "), RADA_SPOLECZNA)
        # A prefix match would sweep in a form the register spells differently
        # and supervises differently, the way it would for "SPÓŁKA AKCYJNA W
        # ORGANIZACJI" - see `matches_form`.
        self.assertEqual(supervisory_body(f"{SPZOZ} W LIKWIDACJI"), "")

    def test_every_mapped_form_resolves(self):
        # Guards against an entry added to the table with a spelling
        # `matches_form` cannot reach.
        for form, body in SUPERVISORY_BODY_BY_FORM.items():
            self.assertEqual(supervisory_body(form), body)


if __name__ == "__main__":
    unittest.main()
