"""Builds the Olist summaries from the Brazilian E-Commerce Public Dataset.

Reads the raw Olist zip (downloaded to .cache/raw/, never committed) and writes:

- data/olist_sales.json: a columnar cube of delivered orders by month, category and state.
- data/olist_rfm.json: RFM segments of customers per state.
- tests/fixtures/rfm_parity.json: 40 synthetic customers scored with the same function, so the
  TypeScript port can be checked against Python (it needs no raw data).

Run with: uv run python -m prep olist
"""

import json
import zipfile
from pathlib import Path

import numpy as np
import pandas as pd

from prep.download import fetch

ROOT = Path(__file__).resolve().parent.parent
SALES_OUT = ROOT / "data" / "olist_sales.json"
RFM_OUT = ROOT / "data" / "olist_rfm.json"
PARITY_OUT = ROOT / "tests" / "fixtures" / "rfm_parity.json"

SOURCE = "Olist, Brazilian E-Commerce Public Dataset, Kaggle (https://www.kaggle.com/datasets/olistbr/brazilian-ecommerce)"
LICENSE = (
    "CC BY-NC-SA 4.0 (https://creativecommons.org/licenses/by-nc-sa/4.0/). "
    "Attribution: Olist, Brazilian E-Commerce Public Dataset, Kaggle. "
    "Non-commercial use only; derived files must be shared under the same license."
)

FIRST_MONTH = "2017-01"
LAST_MONTH = "2018-08"
RANGE_START = "2017-01-01"
AS_OF = "2018-09-01"  # the day after the last full month in the data
UNKNOWN = "unknown"
OTHER = "other"
MAX_SALES_BYTES = 900_000
TOP_CATEGORIES = 40
REVENUE_DECIMALS = 2

SEGMENTS = [
    "champions",
    "loyal",
    "big_spenders_new",
    "recent",
    "needs_attention",
    "at_risk_high_value",
    "hibernating",
]
RFM_RULES = [
    "Population: customer_unique_id with at least one delivered order purchased before as_of.",
    (
        "R = whole days from the date of the customer's last purchase to as_of. F = distinct "
        "delivered orders. M = sum of item prices (no freight, BRL) over those orders."
    ),
    (
        "R score: pandas qcut into 5 bins of rank(method='first') of R ascending, then reversed, "
        "so R=5 is the most recent fifth. Ties are ranked in input order (customers sorted by "
        "customer_unique_id)."
    ),
    (
        "M score: pandas qcut into 5 bins of rank(method='first') of M ascending, so M=5 is the "
        "highest-spending fifth. Ties are ranked in input order."
    ),
    "F score: 1 order -> 1, 2 orders -> 3, 3 or more orders -> 5.",
    (
        "Segment, first match wins: champions (R>=4 and F>=3), loyal (F>=3), big_spenders_new "
        "(R>=4 and M=5), recent (R>=4), needs_attention (R=3), at_risk_high_value "
        "(R<=2 and M>=4), hibernating (otherwise)."
    ),
    "State = customer_state of the customer's most recent order.",
]

PARITY_SEED = 7
PARITY_SIZE = 40


# ------------------------------------------------------------------ loading


def load_tables() -> dict[str, pd.DataFrame]:
    """Reads the six Olist files used here straight from the cached zip."""
    names = {
        "orders": "olist_orders_dataset.csv",
        "order_items": "olist_order_items_dataset.csv",
        "products": "olist_products_dataset.csv",
        "translation": "product_category_name_translation.csv",
        "customers": "olist_customers_dataset.csv",
        "reviews": "olist_order_reviews_dataset.csv",
    }
    tables = {}
    with zipfile.ZipFile(fetch("olist")) as zf:
        for key, filename in names.items():
            with zf.open(filename) as f:
                tables[key] = pd.read_csv(f)
    for column in (
        "order_purchase_timestamp",
        "order_delivered_customer_date",
        "order_estimated_delivery_date",
    ):
        tables["orders"][column] = pd.to_datetime(tables["orders"][column])
    tables["reviews"]["review_answer_timestamp"] = pd.to_datetime(
        tables["reviews"]["review_answer_timestamp"]
    )
    return tables


def delivered(orders: pd.DataFrame) -> pd.DataFrame:
    return orders[orders["order_status"] == "delivered"]


# ------------------------------------------------------------------ sales cube


def _latest_review_score(reviews: pd.DataFrame) -> pd.Series:
    """Score of each order's latest review by review_answer_timestamp (review_id breaks ties)."""
    ordered = reviews.sort_values(["order_id", "review_answer_timestamp", "review_id"])
    return ordered.drop_duplicates("order_id", keep="last").set_index("order_id")["review_score"]


def _item_categories(tables: dict[str, pd.DataFrame]) -> pd.DataFrame:
    products = tables["products"].merge(
        tables["translation"], on="product_category_name", how="left"
    )
    products["category"] = products["product_category_name_english"].fillna(UNKNOWN)
    items = tables["order_items"].merge(
        products[["product_id", "category"]], on="product_id", how="left"
    )
    items["category"] = items["category"].fillna(UNKNOWN)
    return items


def build_sales(tables: dict[str, pd.DataFrame], top_categories: int | None = None) -> dict:
    orders = delivered(tables["orders"])
    month = orders["order_purchase_timestamp"].dt.strftime("%Y-%m")
    orders = orders[(month >= FIRST_MONTH) & (month <= LAST_MONTH)].copy()
    orders["month"] = orders["order_purchase_timestamp"].dt.strftime("%Y-%m")
    orders["late"] = (
        orders["order_delivered_customer_date"] > orders["order_estimated_delivery_date"]
    ).astype(int)
    orders = orders.merge(tables["customers"][["customer_id", "customer_state"]], on="customer_id")
    orders["review_score"] = orders["order_id"].map(_latest_review_score(tables["reviews"]))

    items = _item_categories(tables)
    items = items[items["order_id"].isin(orders["order_id"])]
    if top_categories is not None:
        revenue_by_category = items.groupby("category")["price"].sum().sort_values(ascending=False)
        keep = set(revenue_by_category.index[:top_categories])
        items = items.assign(category=items["category"].where(items["category"].isin(keep), OTHER))

    per_order_category = items.groupby(["order_id", "category"], as_index=False).agg(
        items=("order_item_id", "size"), revenue=("price", "sum")
    )
    joined = per_order_category.merge(
        orders[["order_id", "month", "customer_state", "review_score", "late"]], on="order_id"
    )
    cube = (
        joined.groupby(["month", "category", "customer_state"])
        .agg(
            orders=("order_id", "size"),
            items=("items", "sum"),
            revenue=("revenue", "sum"),
            review_sum=("review_score", "sum"),
            review_n=("review_score", "count"),
            late_n=("late", "sum"),
        )
        .reset_index()
        .sort_values(["month", "category", "customer_state"])
    )

    months = sorted(cube["month"].unique())
    categories = sorted(cube["category"].unique())
    states = sorted(cube["customer_state"].unique())
    return {
        "source": SOURCE,
        "license": LICENSE,
        "months": months,
        "categories": categories,
        "states": states,
        "rows": {
            "m": [months.index(v) for v in cube["month"]],
            "c": [categories.index(v) for v in cube["category"]],
            "s": [states.index(v) for v in cube["customer_state"]],
            "orders": cube["orders"].astype(int).tolist(),
            "items": cube["items"].astype(int).tolist(),
            "revenue": cube["revenue"].round(REVENUE_DECIMALS).astype(float).tolist(),
            "review_sum": cube["review_sum"].astype(int).tolist(),
            "review_n": cube["review_n"].astype(int).tolist(),
            "late_n": cube["late_n"].astype(int).tolist(),
        },
    }


# ------------------------------------------------------------------ RFM scoring


def frequency_score(orders: int) -> int:
    """1 order -> 1, 2 orders -> 3, 3 or more -> 5."""
    if orders >= 3:
        return 5
    return 3 if orders == 2 else 1


def segment_for(r: int, f: int, m: int) -> str:
    """First matching segment for the given R, F and M scores."""
    if r >= 4 and f >= 3:
        return "champions"
    if f >= 3:
        return "loyal"
    if r >= 4 and m == 5:
        return "big_spenders_new"
    if r >= 4:
        return "recent"
    if r == 3:
        return "needs_attention"
    if r <= 2 and m >= 4:
        return "at_risk_high_value"
    return "hibernating"


def _quintile(values: pd.Series) -> pd.Series:
    """Quintile 0..4 of the values, with ties ranked in input order."""
    return pd.qcut(values.rank(method="first"), 5, labels=False).astype(int)


def score_rfm(frame: pd.DataFrame) -> pd.DataFrame:
    """Adds r_score, f_score, m_score and segment to a frame with recency_days, orders, revenue.

    This is the only RFM implementation: the Olist summary and the parity fixture both use it.
    """
    scored = frame.copy()
    scored["r_score"] = 5 - _quintile(scored["recency_days"])
    scored["f_score"] = [frequency_score(int(n)) for n in scored["orders"]]
    scored["m_score"] = 1 + _quintile(scored["revenue"])
    scored["segment"] = [
        segment_for(int(r), int(f), int(m))
        for r, f, m in zip(scored["r_score"], scored["f_score"], scored["m_score"], strict=True)
    ]
    return scored


# ------------------------------------------------------------------ RFM summary


def build_customers(tables: dict[str, pd.DataFrame], as_of: str = AS_OF) -> pd.DataFrame:
    """One row per customer_unique_id with recency_days, orders, revenue and state."""
    orders = delivered(tables["orders"])
    orders = orders[orders["order_purchase_timestamp"] < pd.Timestamp(as_of)]
    orders = orders.merge(
        tables["customers"][["customer_id", "customer_unique_id", "customer_state"]],
        on="customer_id",
    )
    order_revenue = tables["order_items"].groupby("order_id")["price"].sum()
    orders["revenue"] = orders["order_id"].map(order_revenue).fillna(0.0)
    orders = orders.sort_values(["customer_unique_id", "order_purchase_timestamp", "order_id"])

    grouped = orders.groupby("customer_unique_id")
    customers = pd.DataFrame(
        {
            "last_purchase": grouped["order_purchase_timestamp"].max(),
            "orders": grouped["order_id"].nunique(),
            "revenue": grouped["revenue"].sum(),
            "state": grouped["customer_state"].last(),
        }
    )
    days = pd.Timestamp(as_of) - customers["last_purchase"].dt.normalize()
    customers["recency_days"] = days.dt.days
    return customers.sort_index().reset_index()


def build_rfm(tables: dict[str, pd.DataFrame]) -> dict:
    scored = score_rfm(build_customers(tables))
    grouped = scored.groupby(["state", "segment"]).agg(
        customers=("customer_unique_id", "size"),
        revenue=("revenue", "sum"),
        avg_recency_days=("recency_days", "mean"),
        avg_orders=("orders", "mean"),
        avg_monetary=("revenue", "mean"),
    )
    summary = []
    for (state, segment), row in grouped.sort_index().iterrows():
        summary.append(
            {
                "state": state,
                "segment": segment,
                "customers": int(row["customers"]),
                "revenue": round(float(row["revenue"]), REVENUE_DECIMALS),
                "avg_recency_days": round(float(row["avg_recency_days"]), 1),
                "avg_orders": round(float(row["avg_orders"]), 3),
                "avg_monetary": round(float(row["avg_monetary"]), REVENUE_DECIMALS),
            }
        )
    return {
        "source": SOURCE,
        "license": LICENSE,
        "as_of": AS_OF,
        "rules": RFM_RULES,
        "summary": summary,
    }


# ------------------------------------------------------------------ parity fixture


def build_parity() -> dict:
    """40 synthetic customers (seed 7) scored by score_rfm.

    Days since the last order come from a small grid and revenue is rounded to tens, so there are
    ties in recency and in monetary value. The input order is the generation order, which is the
    tie-break order of rank(method="first").
    """
    rng = np.random.default_rng(PARITY_SEED)
    days_ago = rng.integers(1, 21, PARITY_SIZE) * 9
    orders = rng.choice([1, 2, 3, 4], size=PARITY_SIZE, p=[0.45, 0.25, 0.2, 0.1])
    revenue = np.maximum(10.0, np.round(rng.lognormal(4.8, 0.9, PARITY_SIZE) / 10) * 10)

    as_of = pd.Timestamp(AS_OF)
    frame = pd.DataFrame(
        {
            "customer_id": [f"C{i + 1:03d}" for i in range(PARITY_SIZE)],
            "last_order_date": [
                (as_of - pd.Timedelta(days=int(d))).strftime("%Y-%m-%d") for d in days_ago
            ],
            "orders": orders.astype(int),
            "revenue": revenue.astype(float),
            "recency_days": days_ago.astype(int),
        }
    )
    scored = score_rfm(frame)
    columns = [
        "customer_id",
        "last_order_date",
        "orders",
        "revenue",
        "r_score",
        "f_score",
        "m_score",
        "segment",
    ]
    return {
        "as_of": AS_OF,
        "customers": json.loads(scored[columns].to_json(orient="records")),
    }


# ------------------------------------------------------------------ writing


def write_json(path: Path, payload: dict, indent: int | None = None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    separators = (",", ":") if indent is None else None
    text = json.dumps(payload, indent=indent, separators=separators)
    with path.open("w", encoding="utf-8", newline="\n") as f:
        f.write(text + "\n")
    print(f"wrote {path} ({path.stat().st_size} bytes)")


def main() -> None:
    tables = load_tables()
    sales = build_sales(tables)
    size = len(json.dumps(sales, separators=(",", ":")).encode("utf-8"))
    if size > MAX_SALES_BYTES:
        print(f"sales cube is {size} bytes; keeping the top {TOP_CATEGORIES} categories")
        sales = build_sales(tables, top_categories=TOP_CATEGORIES)
    write_json(SALES_OUT, sales)
    write_json(RFM_OUT, build_rfm(tables), indent=1)
    write_json(PARITY_OUT, build_parity(), indent=1)


if __name__ == "__main__":
    main()
