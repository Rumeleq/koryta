import argparse
from functools import cached_property

import numpy as np
import pandas as pd

from analysis.interesting import Companies
from entities.company import display_name
from entities.company_categories import categories_for
from scrapers.koryta.download import KorytaCompanies
from scrapers.stores import Context, Pipeline


class CompaniesPayloads(Pipeline):
    """Emits ingest payloads for companies already submitted to koryta.pl.

    Joins the enriched `Companies` data (PKD `activity` + the `is_public`
    spółka-publiczna flag) with the set of companies already on the site
    (`KorytaCompanies`), so a migration re-submits only companies that already
    exist.

    The payloads carry `categories`, worked out here by
    `entities.company_categories`. The site used to derive them itself from the
    `activity` codes in the payload, which put the whole mapping - two vintages
    of PKD, and an override list for the companies neither vintage places
    correctly - behind a frontend constant that nothing could test against the
    register. A category a person has edited on the site is not overwritten:
    the ingest endpoint skips any node carrying `categoriesSource: "manual"`.

    The payloads carry `teryt_code`, which the uploader maps to the `teryt`
    field the ingest endpoint links a company to its region with. They still
    carry no owners, so no ownership edges are touched. Location edges used to
    be left out too, because the endpoint allocated a random id per edge and
    re-running duplicated them; it now derives the id from the link itself and
    skips edges that already exist, so this is safe to re-run.
    """

    volatile = True
    filename = None

    companies: Companies

    @cached_property
    def args(self):
        parser = argparse.ArgumentParser()
        parser.add_argument(
            "--koryta-date",
            help="Date (YYYY-MM-DD) of the koryta.pl export listing already "
            "submitted companies. Defaults to the latest available export.",
            default=None,
        )
        return parser.parse_known_args()[0]

    def process(self, ctx: Context):
        # TODO this should be a field and dependency
        submitted_df = KorytaCompanies(self.args.koryta_date).read_or_process(ctx)
        submitted_krs = {
            str(krs).zfill(10) for krs in submitted_df["krs"].dropna().tolist()
        }
        print(f"{len(submitted_krs)} companies already submitted to koryta.pl")

        companies_df = self.companies.read_or_process(ctx)

        payloads = []
        with_teryt = 0
        for row in companies_df.to_dict(orient="records"):
            krs = row.get("krs")
            if krs is None or (isinstance(krs, float) and np.isnan(krs)):
                continue
            krs = str(krs).zfill(10)
            if krs not in submitted_krs:
                continue

            name = row.get("name")
            if not isinstance(name, str) or not name:
                name = krs
            else:
                city = row.get("city")
                name = display_name(name, city if isinstance(city, str) else None)

            activity = row.get("activity")
            if not isinstance(activity, (list, np.ndarray)):
                activity = []

            is_public = row.get("is_public")
            is_public = (
                bool(is_public) if isinstance(is_public, (bool, np.bool_)) else False
            )

            payload = {
                "krs": krs,
                "name": name,
                "activity": list(activity),
                "categories": categories_for(krs, list(activity)),
                "is_public": is_public,
            }

            teryt_code = row.get("teryt_code")
            if isinstance(teryt_code, str) and teryt_code.strip():
                payload["teryt_code"] = teryt_code.strip()
                with_teryt += 1

            payloads.append(payload)

        print(
            f"Emitting {len(payloads)} company payloads "
            f"({with_teryt} with a TERYT code)"
        )
        if not payloads:
            return pd.DataFrame(
                columns=[
                    "krs",
                    "name",
                    "activity",
                    "categories",
                    "is_public",
                    "teryt_code",
                ]
            )
        return pd.DataFrame.from_records(payloads)
