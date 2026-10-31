import json
from collections import Counter
from pathlib import Path

import pandas as pd
import pytest

from prep import olist

ROOT = Path(__file__).resolve().parent.parent.parent
SALES = ROOT / "data" / "olist_sales.json"
RFM = ROOT / "data" / "olist_rfm.json"
PARITY = ROOT / "tests" / "fixtures" / "rfm_parity.json"
SEGMENTS = {
    "champions",
    "loyal",
    "big_spenders_new",
    "recent",
    "needs_attention",
    "at_risk_high_value",
    "hibernating",
}
ATTRIBUTION = "Olist, Brazilian E-Commerce Public Dataset, Kaggle"
SALES_COLUMNS = {"m", "c", "s", "orders", "items", "revenue", "review_sum", "review_n", "late_n"}
RFM_ROW_KEYS = {
    "state",
    "segment",
    "customers",
    "revenue",
    "avg_recency_days",
    "avg_orders",
    "avg_monetary",
}
PARITY_KEYS = {
    "customer_id",
    "last_order_date",
    "orders",
    "revenue",
    "r_score",
    "f_score",
    "m_score",
    "segment",
}


@pytest.fixture(scope="module")
def sales() -> dict:
    return json.loads(SALES.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def rfm() -> dict:
    return json.loads(RFM.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def parity() -> dict:
    return json.loads(PARITY.read_text(encoding="utf-8"))


@pytest.fixture(scope="module")
def raw_tables() -> dict:
    return olist.load_tables()


def delivered_in_range(orders: pd.DataFrame) -> pd.DataFrame:
    return orders[
        (orders["order_status"] == "delivered")
        & (orders["order_purchase_timestamp"] >= "2017-01-01")
        & (orders["order_purchase_timestamp"] < "2018-09-01")
    ]


# ---------------------------------------------------------------- sales cube (committed JSON)


def test_sales_carries_source_and_license(sales):
    assert ATTRIBUTION in sales["source"]
    assert "CC BY-NC-SA 4.0" in sales["license"]


def test_sales_months_cover_2017_01_to_2018_08(sales):
    months = sales["months"]
    assert months[0] == "2017-01" and months[-1] == "2018-08"
    assert len(months) == 20 and months == sorted(months)


def test_sales_rows_are_columnar_and_index_the_lists(sales):
    rows = sales["rows"]
    assert set(rows) == SALES_COLUMNS
    length = len(rows["m"])
    assert length > 1000
    assert all(len(column) == length for column in rows.values())
    assert 0 <= min(rows["m"]) and max(rows["m"]) < len(sales["months"])
    assert 0 <= min(rows["c"]) and max(rows["c"]) < len(sales["categories"])
    assert 0 <= min(rows["s"]) and max(rows["s"]) < len(sales["states"])
    cells = set(zip(rows["m"], rows["c"], rows["s"], strict=True))
    assert len(cells) == length  # one row per month, category and state


def test_sales_counts_are_consistent(sales):
    rows = sales["rows"]
    for i in range(len(rows["m"])):
        assert rows["orders"][i] >= 1
        assert rows["items"][i] >= rows["orders"][i]
        assert rows["revenue"][i] >= 0
        assert rows["review_n"][i] <= rows["orders"][i]
        assert rows["late_n"][i] <= rows["orders"][i]
        assert rows["review_n"][i] <= rows["review_sum"][i] <= 5 * rows["review_n"][i]


def test_sales_lists_are_sorted_and_use_unknown_for_missing_categories(sales):
    assert sales["categories"] == sorted(sales["categories"])
    assert sales["states"] == sorted(sales["states"])
    assert "unknown" in sales["categories"]
    assert len(sales["states"]) == 27


# ---------------------------------------------------------------- sales cube vs raw


@pytest.mark.raw
def test_orders_per_category_equal_distinct_delivered_orders_in_range(sales, raw_tables):
    orders = delivered_in_range(raw_tables["orders"])
    items = raw_tables["order_items"].merge(orders[["order_id"]], on="order_id")
    products = raw_tables["products"].merge(
        raw_tables["translation"], on="product_category_name", how="left"
    )
    products["category"] = products["product_category_name_english"].fillna("unknown")
    items = items.merge(products[["product_id", "category"]], on="product_id", how="left")
    items["category"] = items["category"].fillna("unknown")
    expected = items.groupby("category")["order_id"].nunique().to_dict()

    rows = sales["rows"]
    got: Counter = Counter()
    for c, n in zip(rows["c"], rows["orders"], strict=True):
        got[sales["categories"][c]] += n
    if olist.OTHER in got and olist.OTHER not in expected:
        # The long tail was rolled into 'other': compare the categories that were kept.
        expected = {k: v for k, v in expected.items() if k in got}
        got = Counter({k: v for k, v in got.items() if k != olist.OTHER})
    assert dict(got) == expected


@pytest.mark.raw
def test_sales_revenue_and_items_match_the_raw_items(sales, raw_tables):
    orders = delivered_in_range(raw_tables["orders"])
    items = raw_tables["order_items"].merge(orders[["order_id"]], on="order_id")
    rows = sales["rows"]
    assert sum(rows["items"]) == len(items)
    assert sum(rows["revenue"]) == pytest.approx(items["price"].sum(), abs=1.0)


# ---------------------------------------------------------------- RFM scoring (one implementation)


@pytest.mark.parametrize(
    ("orders", "expected"),
    [(1, 1), (2, 3), (3, 5), (4, 5), (30, 5)],
)
def test_frequency_score(orders, expected):
    assert olist.frequency_score(orders) == expected


@pytest.mark.parametrize(
    ("r", "f", "m", "expected"),
    [
        (5, 5, 1, "champions"),
        (4, 5, 5, "champions"),
        (3, 5, 5, "loyal"),
        (1, 5, 1, "loyal"),
        (4, 3, 1, "champions"),  # 2 orders already score F=3
        (2, 3, 1, "loyal"),
        (4, 1, 5, "big_spenders_new"),
        (5, 1, 5, "big_spenders_new"),
        (4, 1, 4, "recent"),
        (5, 1, 1, "recent"),
        (3, 1, 1, "needs_attention"),
        (3, 1, 5, "needs_attention"),
        (2, 1, 4, "at_risk_high_value"),
        (1, 1, 5, "at_risk_high_value"),
        (2, 1, 3, "hibernating"),
        (1, 1, 1, "hibernating"),
    ],
)
def test_segment_rules_first_match_wins(r, f, m, expected):
    assert olist.segment_for(r, f, m) == expected


def test_scores_use_rank_first_so_ties_follow_input_order():
    frame = pd.DataFrame({"recency_days": [5] * 10, "orders": [1] * 10, "revenue": [10.0] * 10})
    scored = olist.score_rfm(frame)
    # Everything is tied, so rank(method="first") is the input order. Recency: the smallest rank
    # is the most recent (R=5). Monetary: the smallest rank is the lowest (M=1).
    assert scored["r_score"].tolist() == [5, 5, 4, 4, 3, 3, 2, 2, 1, 1]
    assert scored["m_score"].tolist() == [1, 1, 2, 2, 3, 3, 4, 4, 5, 5]
    assert scored["f_score"].tolist() == [1] * 10


def test_scores_are_quintiles_with_r5_most_recent():
    frame = pd.DataFrame(
        {
            "recency_days": list(range(1, 101)),
            "orders": [1] * 100,
            "revenue": [float(x) for x in range(1, 101)],
        }
    )
    scored = olist.score_rfm(frame)
    assert Counter(scored["r_score"]) == {1: 20, 2: 20, 3: 20, 4: 20, 5: 20}
    assert scored["r_score"].iloc[0] == 5 and scored["r_score"].iloc[-1] == 1
    assert scored["m_score"].iloc[0] == 1 and scored["m_score"].iloc[-1] == 5


# ---------------------------------------------------------------- RFM summary (committed JSON)


def test_rfm_carries_source_license_rules_and_as_of(rfm):
    assert ATTRIBUTION in rfm["source"]
    assert "CC BY-NC-SA 4.0" in rfm["license"]
    assert rfm["as_of"] == "2018-09-01"
    assert len(rfm["rules"]) >= 5 and all(isinstance(r, str) for r in rfm["rules"])


def test_rfm_summary_shape_and_segment_names(rfm):
    assert rfm["summary"]
    for row in rfm["summary"]:
        assert set(row) == RFM_ROW_KEYS
        assert row["segment"] in SEGMENTS
        assert len(row["state"]) == 2
        assert row["customers"] >= 1
        assert row["avg_orders"] >= 1
        assert row["avg_monetary"] == pytest.approx(row["revenue"] / row["customers"], abs=0.01)
    assert {row["segment"] for row in rfm["summary"]} == SEGMENTS


@pytest.mark.raw
def test_rfm_customers_equal_distinct_unique_ids_before_as_of(rfm, raw_tables):
    orders = raw_tables["orders"]
    orders = orders[
        (orders["order_status"] == "delivered")
        & (orders["order_purchase_timestamp"] < rfm["as_of"])
    ]
    customers = orders.merge(raw_tables["customers"], on="customer_id")
    total = sum(row["customers"] for row in rfm["summary"])
    assert total == customers["customer_unique_id"].nunique()


# ---------------------------------------------------------------- parity fixture


def test_parity_fixture_shape(parity):
    assert parity["as_of"] == "2018-09-01"
    assert len(parity["customers"]) == 40
    for customer in parity["customers"]:
        assert set(customer) == PARITY_KEYS


def test_parity_fixture_covers_all_segments(parity):
    assert {c["segment"] for c in parity["customers"]} == SEGMENTS


def test_parity_fixture_has_ties_that_straddle_a_score_boundary(parity):
    for field, score in (("last_order_date", "r_score"), ("revenue", "m_score")):
        scores_by_value: dict = {}
        for c in parity["customers"]:
            scores_by_value.setdefault(c[field], set()).add(c[score])
        assert any(len(scores) > 1 for scores in scores_by_value.values()), field


def test_parity_fixture_matches_the_scoring_function(parity):
    as_of = pd.Timestamp(parity["as_of"])
    frame = pd.DataFrame(parity["customers"])
    frame["recency_days"] = (as_of - pd.to_datetime(frame["last_order_date"])).dt.days
    scored = olist.score_rfm(frame)
    for column in ("r_score", "f_score", "m_score", "segment"):
        assert scored[column].tolist() == frame[column].tolist(), column


def test_build_parity_is_deterministic():
    assert olist.build_parity() == olist.build_parity()
