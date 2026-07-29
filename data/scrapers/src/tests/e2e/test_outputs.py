"""Generic checks over whatever the pipeline run wrote to versioned/.

Two failure modes worth catching, neither of which shows up as an exception
during the run itself: an output stopping being produced, and an output still
being produced but with a column that quietly stopped being populated.
"""

import pytest

from tests.e2e.conftest import (
    OUTPUTS,
    output_path,
    required_outputs,
    strict,
    tier,
)

TRACKED = sorted(OUTPUTS)

pytestmark = pytest.mark.e2e


def column_coverage(df) -> dict[str, float]:
    """Fraction of rows where each column is populated."""
    if len(df) == 0:
        return {}
    return {str(c): round(float(df[c].notna().mean()), 4) for c in df.columns}


def test_required_outputs_exist():
    required = required_outputs()
    assert required, f"no required outputs declared for tier {tier()!r}"

    missing = [
        name
        for name in sorted(required)
        if not output_path(name, OUTPUTS[name]["format"]).exists()
    ]
    if missing and not strict():
        pytest.skip(f"no pipeline output to check: {', '.join(missing)}")
    assert not missing, (
        f"pipeline run produced no output for: {', '.join(missing)}. "
        "The run reported success, so this is a pipeline that silently did "
        "nothing rather than one that crashed."
    )


@pytest.mark.parametrize("name", TRACKED)
def test_output_is_readable_and_non_empty(name, read_output, metrics):
    df = read_output(name, OUTPUTS[name]["format"])
    metrics.setdefault(name, {})["rows"] = len(df)
    metrics[name]["non_null"] = column_coverage(df)

    assert len(df) > 0, f"{name} was written but is empty"


@pytest.mark.parametrize("name", TRACKED)
def test_row_count_within_band(name, read_output, baseline, metrics):
    expected = OUTPUTS[name]["rows"]
    if expected is None:
        pytest.skip(f"{name} has no baseline row count yet")
    if tier() != "full":
        pytest.skip(f"row counts are only meaningful on the full dump, not {tier()}")

    df = read_output(name, OUTPUTS[name]["format"])
    metrics.setdefault(name, {})["rows"] = len(df)

    tolerance = baseline["tolerance"]["rows"]
    low, high = expected * (1 - tolerance), expected * (1 + tolerance)
    assert low <= len(df) <= high, (
        f"{name} has {len(df)} rows, outside {low:.0f}-{high:.0f} "
        f"(baseline {expected}, tolerance {tolerance:.0%}). If this is a real "
        "change in the sources, rerun with KORYTA_E2E_UPDATE_BASELINE=1 and "
        "commit the new baseline."
    )


@pytest.mark.parametrize("name", TRACKED)
def test_column_coverage_has_not_dropped(name, read_output, baseline, metrics):
    expected = OUTPUTS[name]["non_null"]
    if not expected:
        pytest.skip(f"{name} has no baseline column coverage yet")

    df = read_output(name, OUTPUTS[name]["format"])
    observed = column_coverage(df)
    metrics.setdefault(name, {})["non_null"] = observed

    missing = sorted(set(expected) - set(observed))
    assert not missing, f"{name} lost column(s): {', '.join(missing)}"

    tolerance = baseline["tolerance"]["non_null"]
    # Only a drop is a regression -- a column getting better populated is not.
    dropped = {
        column: (expected[column], observed[column])
        for column in expected
        if observed[column] < expected[column] - tolerance
    }
    assert not dropped, "\n".join(
        f"{name}.{column} populated in {now:.1%} of rows, was {was:.1%}"
        for column, (was, now) in sorted(dropped.items())
    )
