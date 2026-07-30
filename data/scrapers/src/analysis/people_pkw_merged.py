from analysis.utils.tables import create_people_table
from scrapers.pkw.process import PeoplePKW
from scrapers.stores import Context, Pipeline


class PeoplePKWMerged(Pipeline):
    filename = "people_pkw_merged"
    pkw_pipeline: PeoplePKW

    def process(self, ctx: Context):
        return people_pkw_merged(ctx, self.pkw_pipeline.read_or_process(ctx))


def people_pkw_merged(ctx: Context, pkw_data):  # noqa: F841
    con = ctx.con

    con.execute(
        """
    CREATE OR REPLACE TABLE people_pkw_merged_raw AS
    SELECT
        lower(first_name) as first_name,
        lower(last_name) as last_name,
        lower(middle_name) as second_name,
        -- Where the candidacy was, and where the candidate lived, which
        -- are not the same question and used to be answered by the same
        -- unordered list. `list_distinct` drops NULLs and reorders what is
        -- left, so for anybody whose home powiat differs from the one they
        -- stood in - and PKW does not always record the first - the
        -- residence could come out in front, and everything downstream
        -- takes element one.
        teryt_candidacy[:2] as teryt_candidacy_wojewodztwo,
        teryt_candidacy[:4] as teryt_candidacy_powiat,
        teryt_living[:2] as teryt_living_wojewodztwo,
        teryt_living[:4] as teryt_living_powiat,
        -- Everywhere the person is connected to, candidacy first.
        -- `list_filter` keeps the order `list_distinct` did not.
        list_filter([
            teryt_candidacy[:2],
            teryt_living[:2],
        ], x -> x IS NOT NULL) as teryt_wojewodztwo,
        list_filter([
            teryt_candidacy[:4],
            teryt_living[:4],
        ], x -> x IS NOT NULL) as teryt_powiat,
        birth_year,
        pkw_name as full_name,
        party,
        election_year,
        election_type,
        candidacy_success,
    FROM pkw_data
    WHERE first_name IS NOT NULL AND last_name IS NOT NULL
    """
    )

    row_num = len(con.sql("select * from people_pkw_merged_raw").df())
    print(f"people_pkw_merged_raw has {row_num} rows")

    create_people_table(
        con,
        "people_pkw_merged",
        to_list=["full_name"],
        flatten_list=["teryt_wojewodztwo", "teryt_powiat"],
        elections={
            "party": "party",
            "election_year": "election_year",
            "election_type": "election_type",
            "teryt_candidacy_wojewodztwo": "teryt_candidacy_wojewodztwo",
            "teryt_candidacy_powiat": "teryt_candidacy_powiat",
            "teryt_living_wojewodztwo": "teryt_living_wojewodztwo",
            "teryt_living_powiat": "teryt_living_powiat",
            "teryt_wojewodztwo": "teryt_wojewodztwo",
            "teryt_powiat": "teryt_powiat",
            "candidacy_success": "candidacy_success",
        },
    )

    return con.sql("select * from people_pkw_merged").df()
