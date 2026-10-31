import json
import zipfile
from collections import Counter
from pathlib import Path

import pandas as pd
import pytest

from prep import download

ROOT = Path(__file__).resolve().parent.parent.parent
FUNNEL = ROOT / "data" / "olist_funnel.json"
ORIGINS = {
    "organic_search",
    "paid_search",
    "social",
    "unknown",
    "direct_traffic",
    "email",
    "referral",
    "other",
    "display",
    "other_publicities",
}


@pytest.fixture(scope="module")
def funnel() -> dict:
    return json.loads(FUNNEL.read_text(encoding="utf-8"))


def test_funnel_carries_source_and_license(funnel):
    assert "Olist" in funnel["source"] and "Marketing Funnel" in funnel["source"]
    assert "CC BY-NC-SA 4.0" in funnel["license"]


def test_mql_total_is_8000(funnel):
    assert sum(sum(row) for row in funnel["mql"]["counts"]) == 8000


def test_mql_matrix_is_months_by_origins(funnel):
    mql = funnel["mql"]
    assert len(mql["counts"]) == len(mql["months"])
    assert all(len(row) == len(mql["origins"]) for row in mql["counts"])
    assert mql["months"] == sorted(mql["months"])
    assert mql["months"][0] == "2017-06" and mql["months"][-1] == "2018-05"
    assert set(mql["origins"]) == ORIGINS
    assert mql["origins"] == sorted(mql["origins"])


def test_deal_total_is_842_and_columns_align(funnel):
    deals = funnel["deals"]
    assert len(deals["origin"]) == 842
    for column in ("contact_month", "segment", "days_to_close"):
        assert len(deals[column]) == 842
    assert set(deals["origin"]) <= ORIGINS
    days = deals["days_to_close"]
    assert all(isinstance(d, int) for d in days)
    assert max(days) < 1000
    # One deal in the source was won 2 days before its recorded first contact; it is kept as is.
    assert sum(d < 0 for d in days) <= 1 and min(days) >= -2
    assert "" not in deals["segment"]
    assert set(deals["contact_month"]) <= set(funnel["mql"]["months"])


@pytest.mark.raw
def test_funnel_matches_the_raw_files(funnel):
    zf = zipfile.ZipFile(download.fetch("olist_funnel"))
    mql = pd.read_csv(zf.open("olist_marketing_qualified_leads_dataset.csv"))
    deals = pd.read_csv(zf.open("olist_closed_deals_dataset.csv"))
    assert len(mql) == 8000 and len(deals) == 842
    expected = Counter(mql["origin"].fillna("unknown"))
    got = {
        origin: sum(row[j] for row in funnel["mql"]["counts"])
        for j, origin in enumerate(funnel["mql"]["origins"])
    }
    assert got == dict(expected)
    unknown_segments = int(deals["business_segment"].isna().sum())
    assert Counter(funnel["deals"]["segment"])["unknown"] == unknown_segments
