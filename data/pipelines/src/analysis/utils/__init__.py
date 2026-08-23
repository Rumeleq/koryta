from collections import Counter
from datetime import date, timedelta

import numpy as np
import pandas as pd

from analysis.utils.elections import candidacy_teryt
from scrapers.map.teryt import Teryt
from scrapers.pkw.elections import parties_of_committee
from scrapers.pkw.sources import election_date
from scrapers.stores import Context


def read_enriched(ctx: Context, matched_all, companies_df, teryt: Teryt):
    # Add derived fields
    company_names = get_company_names(companies_df)
    enriched = append_nice_history(ctx, matched_all, company_names, teryt)
    enriched = enriched.sort_values(by="election_before_work").reset_index()
    return enriched


# TODO this should be a method on Companies pipeline
def get_company_names(companies_df):
    krs_companies = companies_df.to_dict("records")
    company_names_krs = {
        elt["krs"]: f"{elt['name']} w {elt['city']}" for elt in krs_companies
    }
    return {
        **company_names_krs,
    }


def extract_companies(ctx: Context, df, company_names):
    krs: Counter[str] = Counter()
    for es in df["employment"].to_list():
        for e in es:
            krs[e["employed_krs"]] += 1

    return [
        (krs, company_names.get(krs, krs), count)
        for krs, count in krs.most_common()
        if count > 3
    ]


def append_nice_history(ctx: Context, df, company_names, teryt: Teryt):
    missing_teryt = set()

    def nice_history(row):
        actions = []

        first_work: date | None = None
        last_employed: date | None = None
        employed_total = timedelta(days=0)
        parties_simplified = set()

        for emp in empty_list_if_nan(row["employment"]):
            duration = timedelta(days=365 * float(emp["employed_for"]))
            emp_end = emp.get("employed_end")
            emp_end_str = emp_end if emp_end is not None else date.today().isoformat()

            start_employed: date = date.fromisoformat(emp_end_str) - duration
            if first_work is None or start_employed < first_work:
                first_work = start_employed
            if last_employed is None or (
                emp["employed_end"] and emp["employed_end"] > str(last_employed)
            ):
                last_employed = emp["employed_end"]
            employed_total += duration

            emp["employment_start"] = start_employed
            company_name = company_names.get(emp["employed_krs"], emp["employed_krs"])

            end_display = emp_end if emp_end is not None else "obecnie"
            text = f"Pracuje od {start_employed} do {end_display} w {company_name}"
            actions.append((start_employed, text))

        elections = []
        for el in empty_list_if_nan(row["elections"]):
            parties_simplified.update(parties_of_committee(el["party"]))

            start_election: date = election_date.get(
                el["election_year"], date(year=int(el["election_year"]), month=1, day=1)
            )
            elections.append(start_election)
            region_name = "nieznane"
            # Where they stood, not where they lived - see `candidacy_teryt`.
            where = candidacy_teryt(el)
            if where is not None:
                if where in teryt.TERYT:
                    region_name = str(teryt.TERYT[where])
                else:
                    missing_teryt.add(where)

            text = " ".join(
                [
                    f"Kandyduje w {el['election_year']} do {el['election_type']}",
                    f"z list {(el['party'] or '').strip()} w {region_name}",
                ]
            )
            actions.append((start_election, text))

        before_work = [
            e for e in elections if first_work is not None and e < first_work
        ]
        latest_election = max(before_work, default=min(elections, default=None))

        actions.sort(key=lambda x: x[0])
        history = ""
        for a in actions:
            action = a[1]
            history += f"{action}" + "\n"

        election_before_work = None
        if first_work is not None and latest_election is not None:
            election_before_work = first_work - latest_election

        return pd.Series(
            [
                history,
                election_before_work,
                first_work,
                last_employed,
                employed_total,
                parties_simplified,
            ]
        )

    df[
        [
            "history",
            "election_before_work",
            "first_employed",
            "last_employed",
            "employed_total",
            "parties_simplified",
        ]
    ] = df[["employment", "elections"]].apply(nice_history, axis=1)

    print(f"Missing teryt: {missing_teryt}")

    return df


def drop_duplicates(df, *cols):
    for col in cols:
        df = df[(~df[col].duplicated()) | df[col].isna()]
    return df


def as_sequence(value) -> list:
    """A column that should hold a list of things, as a list.

    Which type it actually holds depends on where the frame came from. Straight
    out of DuckDB a LIST column is a `numpy.ndarray`, because that is what
    `.df()` makes of one; read back from the pipeline's own jsonl it is a
    `list`, because that is what a JSON array parses to. So
    ``isinstance(value, list)`` is true on a run that read the cache and false
    on a run that rebuilt it, and code guarded that way does nothing at all on
    the second - `Extract` scored every person 0 and emitted nobody.

    Anything else, a null included, is no items rather than an error: these
    columns are aggregates, and a person with no employment has no employment.
    """
    if isinstance(value, np.ndarray):
        return value.tolist()
    if isinstance(value, (list, tuple)):
        return list(value)
    if isinstance(value, pd.Series):
        return value.tolist()
    return []


def empty_list_if_nan(value):
    if isinstance(value, (np.ndarray, list)):
        return value
    return []
