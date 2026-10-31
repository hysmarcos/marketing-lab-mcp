import { z } from "zod";
import sales from "../../../data/olist_sales.json";
import {
  queryStoreSales,
  type SalesData,
  type SalesMetric,
  type StoreSalesResult,
} from "../../core/store";
import { brl, fitSummary, groupDigits } from "../summary";
import type { ToolSpec } from "../tool";

const data = sales as SalesData;

const monthField = (what: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional()
    .describe(
      `${what} purchase month to include, as YYYY-MM (for example 2017-11). The data covers purchase months 2017-01 to 2018-08.`,
    );

const input = z.strictObject({
  group_by: z
    .enum(["category", "state", "month"])
    .describe(
      "How to split the sales: 'category' (Olist product category), 'state' (Brazilian state of the customer, 2-letter code) or 'month' (purchase month).",
    ),
  metric: z
    .enum(["revenue", "orders", "avg_review", "late_delivery_rate"])
    .optional()
    .describe(
      "What to rank by: 'revenue' (item price in BRL, no freight), 'orders' (delivered orders), 'avg_review' (average review score, 1 to 5) or 'late_delivery_rate' (share of orders delivered after the promised date). Default 'revenue'.",
    ),
  category: z
    .string()
    .max(60)
    .optional()
    .describe(
      "Only count this product category, using Olist's English category names such as health_beauty, bed_bath_table, computers_accessories, sports_leisure or furniture_decor. Case and spaces do not matter ('Health Beauty' works). An unknown name returns no rows and lists the valid names.",
    ),
  state: z
    .string()
    .max(40)
    .optional()
    .describe(
      "Only count customers in this Brazilian state, as its 2-letter code such as SP, RJ, MG, RS or BA. Case does not matter. An unknown code returns no rows and lists the valid codes.",
    ),
  from_month: monthField("First"),
  to_month: monthField("Last"),
  top: z
    .number()
    .int()
    .min(1)
    .max(50)
    .optional()
    .describe(
      "How many rows to return for 'category' and 'state', from 1 to 50. Default 10. Ignored for 'month', which always returns every month in range in date order.",
    ),
});

const METRIC_LABEL: Record<SalesMetric, string> = {
  revenue: "revenue",
  orders: "orders",
  avg_review: "average review score",
  late_delivery_rate: "late-delivery rate",
};

function formatValue(metric: SalesMetric, value: number | null): string {
  if (value === null) return "no reviews";
  if (metric === "revenue") return brl(value);
  if (metric === "orders") return groupDigits(value);
  if (metric === "avg_review") return value.toFixed(2);
  return `${(value * 100).toFixed(1)}%`;
}

function summarize(out: StoreSalesResult): string {
  if (out.rows.length === 0) {
    const head = "No rows matched the filters.";
    const [first = ""] = out.warnings;
    const trimmed = first.length > 700 ? `${first.slice(0, 697)}...` : first;
    return trimmed ? `${head} ${trimmed}` : head;
  }
  const scope =
    out.group_by === "month"
      ? `all ${out.rows.length} months`
      : `top ${out.rows.length} of ${out.groups} ${out.group_by === "category" ? "categories" : "states"}`;
  const head = [
    `Olist store, delivered orders (BRL), by ${out.group_by}, ranked by ${METRIC_LABEL[out.metric]}: ${scope}.`,
    `Total in range: ${brl(out.total.revenue)} from ${groupDigits(out.total.orders)} orders.`,
  ];
  const details = out.rows.map((r) => {
    const orders = `${groupDigits(r.orders)} orders`;
    const money = brl(r.revenue);
    if (out.metric === "revenue") return `${r.key}: ${money}, ${orders}`;
    if (out.metric === "orders") return `${r.key}: ${orders}, ${money}`;
    return `${r.key}: ${formatValue(out.metric, r.value)}, ${orders}, ${money}`;
  });
  return fitSummary(head, details, out.warnings);
}

export const storeSales: ToolSpec<typeof input, StoreSalesResult> = {
  name: "store_sales",
  title: "Store sales explorer",
  description:
    "Use to answer where an online store's sales come from: which product categories, Brazilian states or months drive revenue, orders, customer review scores or late deliveries. Reads a fixed aggregate of the Olist public e-commerce dataset (Brazilian marketplace, delivered orders only, purchase months 2017-01 to 2018-08, about 96,000 orders). Money is in Brazilian reais (BRL) and is item price without freight. Categories are Olist's English category names, for example health_beauty, bed_bath_table, computers_accessories, sports_leisure, furniture_decor and watches_gifts; customers' states are Brazilian 2-letter codes such as SP, RJ, MG. Pick group_by (category, state or month), optionally one metric, and optionally filter to one category, one state or a month range. Returns rows sorted by the metric (top 1 to 50, default 10; months always in date order) with orders and revenue per row, plus totals for everything that matched. An order with items in two categories counts once in each. Late means delivered after the estimated date; a review score is the latest one for the order. It describes this historical marketplace, not your store.",
  input,
  run: (args) => queryStoreSales(data, args),
  summarize,
  examples: [
    { label: "Top 10 categories by revenue", args: { group_by: "category" } },
    {
      label: "Monthly orders during 2017",
      args: { group_by: "month", metric: "orders", from_month: "2017-01", to_month: "2017-12" },
    },
    {
      label: "States with the worst late deliveries in health_beauty",
      args: {
        group_by: "state",
        metric: "late_delivery_rate",
        category: "health_beauty",
        top: 5,
      },
    },
  ],
};
