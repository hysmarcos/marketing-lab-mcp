"""Builds the Hillstrom summaries.

Reads the raw MineThatData e-mail challenge CSV (downloaded to .cache/raw/, never committed) and writes:

- data/hillstrom_cells.json: aggregated cells (one per arm, dimension and value), the only
  Hillstrom data that is committed.
- tests/fixtures/email_reference.json: scipy/statsmodels reference values computed from the
  full rows, used to check src/core/email.ts.

Run with: uv run python -m prep hillstrom
"""

import json
from pathlib import Path

import pandas as pd
from scipy import stats
from statsmodels.stats.proportion import proportions_ztest

from prep.download import fetch

ROOT = Path(__file__).resolve().parent.parent
CELLS_OUT = ROOT / "data" / "hillstrom_cells.json"
REFERENCE_OUT = ROOT / "tests" / "fixtures" / "email_reference.json"

SOURCE = (
    "Hillstrom E-Mail Analytics And Data Mining Challenge (MineThatData, 2008): "
    "aggregated public data, 64,000 customers in three random arms."
)
LICENSE_NOTE = (
    "Source: Kevin Hillstrom, MineThatData E-Mail Analytics And Data Mining Challenge, 2008, "
    "http://www.minethatdata.com/Kevin_Hillstrom_MineThatData_E-MailAnalytics_DataMiningChallenge_2008.03.20.csv. "
    "The dataset states no license. This file keeps only aggregated counts and sums per "
    "arm and segment, not customer rows."
)

ARM_BY_SEGMENT = {"Mens E-Mail": "mens", "Womens E-Mail": "womens", "No E-Mail": "control"}
DIMENSIONS = ["history_segment", "zip_code", "channel", "newbie", "mens", "womens"]
ALPHA = 0.05
# The CSV stores spend with two decimals; rounding removes float noise from the sums.
SPEND_SUM_DECIMALS = 2
SPEND_SQ_SUM_DECIMALS = 4


def load() -> pd.DataFrame:
    raw = pd.read_csv(fetch("hillstrom"))
    raw["zip_code"] = raw["zip_code"].replace({"Surburban": "Suburban"})
    raw["newbie"] = raw["newbie"].map({1: "new", 0: "existing"})
    for column in ("mens", "womens"):
        raw[column] = raw[column].map({1: "bought", 0: "not_bought"})
    raw["arm"] = raw["segment"].map(ARM_BY_SEGMENT)
    raw["spend_sq"] = raw["spend"] ** 2
    raw["overall"] = "all"
    return raw


def build_cells(df: pd.DataFrame) -> list[dict]:
    cells = []
    for dimension in ["overall", *DIMENSIONS]:
        grouped = df.groupby(["arm", dimension], sort=True).agg(
            n=("visit", "size"),
            visits=("visit", "sum"),
            conversions=("conversion", "sum"),
            spend_sum=("spend", "sum"),
            spend_sq_sum=("spend_sq", "sum"),
        )
        for (arm, value), row in grouped.iterrows():
            cells.append(
                {
                    "arm": arm,
                    "dimension": dimension,
                    "value": str(value),
                    "n": int(row["n"]),
                    "visits": int(row["visits"]),
                    "conversions": int(row["conversions"]),
                    "spend_sum": round(float(row["spend_sum"]), SPEND_SUM_DECIMALS),
                    "spend_sq_sum": round(float(row["spend_sq_sum"]), SPEND_SQ_SUM_DECIMALS),
                }
            )
    return cells


def compare(treatment: pd.DataFrame, control: pd.DataFrame, metric: str) -> dict:
    """Treatment vs control with statsmodels (rates) or scipy Welch (spend), from the full rows."""
    n_t, n_c = len(treatment), len(control)
    if metric == "spend":
        t_value, c_value = treatment["spend"].mean(), control["spend"].mean()
        _, p_value = stats.ttest_ind(treatment["spend"], control["spend"], equal_var=False)
    else:
        column = {"visit": "visit", "conversion": "conversion"}[metric]
        x_t, x_c = int(treatment[column].sum()), int(control[column].sum())
        t_value, c_value = x_t / n_t, x_c / n_c
        _, p_value = proportions_ztest([x_t, x_c], [n_t, n_c], value=0)
    uplift = float(t_value - c_value)
    return {
        "n_control": n_c,
        "n_treatment": n_t,
        "control_value": float(c_value),
        "treatment_value": float(t_value),
        "absolute_uplift": uplift,
        "relative_uplift": uplift / float(c_value) if c_value != 0 else None,
        "p_value": float(p_value),
        "significant": bool(p_value < ALPHA),
    }


def build_reference(df: pd.DataFrame) -> dict:
    cases = []
    control = df[df["arm"] == "control"]
    for campaign in ("mens", "womens"):
        treatment = df[df["arm"] == campaign]
        for metric in ("conversion", "spend", "visit"):
            cases.append(
                {
                    "campaign": campaign,
                    "metric": metric,
                    "segment_by": None,
                    "segment": "all",
                    **compare(treatment, control, metric),
                }
            )
            for segment in sorted(df["zip_code"].unique()):
                cases.append(
                    {
                        "campaign": campaign,
                        "metric": metric,
                        "segment_by": "zip_code",
                        "segment": segment,
                        **compare(
                            treatment[treatment["zip_code"] == segment],
                            control[control["zip_code"] == segment],
                            metric,
                        ),
                    }
                )
    return {"alpha": ALPHA, "cases": cases}


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(payload, indent=1) + "\n")
    print(f"wrote {path} ({path.stat().st_size} bytes)")


def main() -> None:
    df = load()
    write_json(
        CELLS_OUT,
        {"source": SOURCE, "license_note": LICENSE_NOTE, "cells": build_cells(df)},
    )
    write_json(REFERENCE_OUT, build_reference(df))


if __name__ == "__main__":
    main()
