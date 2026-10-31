"""Builds the Olist marketing funnel summary.

Reads the Marketing Funnel by Olist zip (downloaded to .cache/raw/, never committed) and writes
data/olist_funnel.json: leads (MQLs) per first-contact month and origin, and one row per closed
deal with its origin, contact month, business segment and days from first contact to won date.

Run with: uv run python -m prep funnel
"""

import json
import zipfile
from pathlib import Path

import pandas as pd

from prep.download import fetch

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "data" / "olist_funnel.json"

SOURCE = "Olist, Marketing Funnel by Olist, Kaggle (https://www.kaggle.com/datasets/olistbr/marketing-funnel-olist)"
LICENSE = (
    "CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/). "
    "Attribution: Olist, Marketing Funnel by Olist, Kaggle. "
    "Non-commercial use only; derived files must be shared under the same license."
)
UNKNOWN = "unknown"


def load() -> tuple[pd.DataFrame, pd.DataFrame]:
    with zipfile.ZipFile(fetch("olist_funnel")) as zf:
        with zf.open("olist_marketing_qualified_leads_dataset.csv") as f:
            mql = pd.read_csv(f)
        with zf.open("olist_closed_deals_dataset.csv") as f:
            deals = pd.read_csv(f)
    return mql, deals


def build(mql: pd.DataFrame, deals: pd.DataFrame) -> dict:
    mql = mql.copy()
    mql["origin"] = mql["origin"].fillna(UNKNOWN).replace("", UNKNOWN)
    mql["contact"] = pd.to_datetime(mql["first_contact_date"])
    mql["contact_month"] = mql["contact"].dt.strftime("%Y-%m")

    months = sorted(mql["contact_month"].unique())
    origins = sorted(mql["origin"].unique())
    matrix = (
        mql.groupby(["contact_month", "origin"])
        .size()
        .unstack(fill_value=0)
        .reindex(index=months, columns=origins, fill_value=0)
    )

    closed = deals.merge(mql[["mql_id", "origin", "contact", "contact_month"]], on="mql_id")
    closed["segment"] = closed["business_segment"].fillna(UNKNOWN).replace("", UNKNOWN)
    closed["won"] = pd.to_datetime(closed["won_date"])
    closed["days_to_close"] = (closed["won"].dt.normalize() - closed["contact"]).dt.days
    closed = closed.sort_values(["won", "mql_id"])

    return {
        "source": SOURCE,
        "license": LICENSE,
        "mql": {
            "months": months,
            "origins": origins,
            "counts": matrix.astype(int).values.tolist(),
        },
        "deals": {
            "origin": closed["origin"].tolist(),
            "contact_month": closed["contact_month"].tolist(),
            "segment": closed["segment"].tolist(),
            "days_to_close": closed["days_to_close"].astype(int).tolist(),
        },
    }


def main() -> None:
    mql, deals = load()
    payload = build(mql, deals)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with OUT.open("w", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(payload, separators=(",", ":")) + "\n")
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
