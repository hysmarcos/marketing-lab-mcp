import { ToolInputError } from "../server/tool";

/** data/olist_sales.json: a columnar cube of delivered orders; the row arrays index into the lists. */
export type SalesData = {
  source: string;
  license: string;
  months: string[];
  categories: string[];
  states: string[];
  rows: {
    m: number[];
    c: number[];
    s: number[];
    orders: number[];
    items: number[];
    revenue: number[];
    review_sum: number[];
    review_n: number[];
    late_n: number[];
  };
};

export type SalesGroupBy = "category" | "state" | "month";
export type SalesMetric = "revenue" | "orders" | "avg_review" | "late_delivery_rate";

export type SalesRow = {
  key: string;
  /** The chosen metric; null only for avg_review when the group has no reviews. */
  value: number | null;
  orders: number;
  revenue: number;
};

export type StoreSalesResult = {
  group_by: SalesGroupBy;
  metric: SalesMetric;
  rows: SalesRow[];
  /** Number of groups that matched the filters, before the `top` cut. */
  groups: number;
  total: { orders: number; revenue: number };
  warnings: string[];
  source: string;
};

export const OLIST_SOURCE =
  "Olist, Brazilian E-Commerce Public Dataset, Kaggle (CC BY-NC-SA 4.0), aggregated";

const DEFAULT_TOP = 10;
const MAX_TOP = 50;
const THIN_ORDERS = 30;
const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

function checkMonth(name: string, value: string | undefined): void {
  if (value !== undefined && !MONTH_PATTERN.test(value)) {
    throw new ToolInputError(`${name} must be a month in YYYY-MM format, for example 2018-03.`);
  }
}

/** Lower case, trimmed, with spaces and hyphens turned into underscores. */
function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}

export function queryStoreSales(
  data: SalesData,
  args: {
    group_by: SalesGroupBy;
    metric?: SalesMetric;
    category?: string;
    state?: string;
    from_month?: string;
    to_month?: string;
    top?: number;
  },
): StoreSalesResult {
  const metric = args.metric ?? "revenue";
  const top = args.top ?? DEFAULT_TOP;
  if (!Number.isInteger(top) || top < 1 || top > MAX_TOP) {
    throw new ToolInputError(`top must be a whole number between 1 and ${MAX_TOP}.`);
  }
  checkMonth("from_month", args.from_month);
  checkMonth("to_month", args.to_month);
  if (args.from_month !== undefined && args.to_month !== undefined) {
    if (args.from_month > args.to_month) {
      throw new ToolInputError(
        `from_month (${args.from_month}) is after to_month (${args.to_month}).`,
      );
    }
  }

  const warnings: string[] = [];
  const empty = (): StoreSalesResult => ({
    group_by: args.group_by,
    metric,
    rows: [],
    groups: 0,
    total: { orders: 0, revenue: 0 },
    warnings,
    source: OLIST_SOURCE,
  });

  let categoryIndex = -1;
  if (args.category !== undefined) {
    const wanted = normalizeKey(args.category);
    categoryIndex = data.categories.indexOf(wanted);
    if (categoryIndex < 0) {
      warnings.push(
        `Unknown category '${args.category}'. Valid categories: ${data.categories.join(", ")}.`,
      );
    }
  }
  let stateIndex = -1;
  if (args.state !== undefined) {
    const wanted = args.state.trim().toUpperCase();
    stateIndex = data.states.indexOf(wanted);
    if (stateIndex < 0) {
      warnings.push(`Unknown state '${args.state}'. Valid states: ${data.states.join(", ")}.`);
    }
  }
  if (warnings.length > 0) return empty();

  const first = data.months[0] ?? "";
  const last = data.months[data.months.length - 1] ?? "";
  const from = args.from_month ?? first;
  const to = args.to_month ?? last;
  if (from > last || to < first) {
    warnings.push(
      `No sales in the requested months: the data covers purchase months ${first} to ${last}.`,
    );
    return empty();
  }
  const monthOk = data.months.map((m) => m >= from && m <= to);

  const size =
    args.group_by === "category"
      ? data.categories.length
      : args.group_by === "state"
        ? data.states.length
        : data.months.length;
  const orders = new Array<number>(size).fill(0);
  const revenue = new Array<number>(size).fill(0);
  const reviewSum = new Array<number>(size).fill(0);
  const reviewN = new Array<number>(size).fill(0);
  const lateN = new Array<number>(size).fill(0);
  const seen = new Array<boolean>(size).fill(false);

  const r = data.rows;
  const groupColumn = args.group_by === "category" ? r.c : args.group_by === "state" ? r.s : r.m;
  for (let i = 0; i < r.m.length; i++) {
    if (!monthOk[r.m[i] as number]) continue;
    if (categoryIndex >= 0 && r.c[i] !== categoryIndex) continue;
    if (stateIndex >= 0 && r.s[i] !== stateIndex) continue;
    const g = groupColumn[i] as number;
    seen[g] = true;
    orders[g] = (orders[g] as number) + (r.orders[i] as number);
    revenue[g] = (revenue[g] as number) + (r.revenue[i] as number);
    reviewSum[g] = (reviewSum[g] as number) + (r.review_sum[i] as number);
    reviewN[g] = (reviewN[g] as number) + (r.review_n[i] as number);
    lateN[g] = (lateN[g] as number) + (r.late_n[i] as number);
  }

  const keys =
    args.group_by === "category"
      ? data.categories
      : args.group_by === "state"
        ? data.states
        : data.months;
  const rows: SalesRow[] = [];
  let totalOrders = 0;
  let totalRevenue = 0;
  for (let g = 0; g < size; g++) {
    if (!seen[g]) continue;
    const o = orders[g] as number;
    const rev = revenue[g] as number;
    totalOrders += o;
    totalRevenue += rev;
    let value: number | null;
    if (metric === "revenue") value = round(rev, 2);
    else if (metric === "orders") value = o;
    else if (metric === "avg_review") {
      const n = reviewN[g] as number;
      value = n > 0 ? round((reviewSum[g] as number) / n, 4) : null;
    } else value = round((lateN[g] as number) / o, 4);
    rows.push({ key: keys[g] as string, value, orders: o, revenue: round(rev, 2) });
  }

  if (args.group_by === "month") {
    rows.sort((a, b) => (a.key < b.key ? -1 : 1));
  } else {
    rows.sort((a, b) => {
      if (a.value === b.value) return a.key < b.key ? -1 : 1;
      if (a.value === null) return 1;
      if (b.value === null) return -1;
      return b.value - a.value;
    });
  }
  const groups = rows.length;
  const shown = args.group_by === "month" ? rows : rows.slice(0, top);

  if (categoryIndex < 0) {
    warnings.push(
      "Orders are counted once per category they contain, so an order with items in two categories counts in each; totals can exceed the distinct orders by under 1%.",
    );
  }
  if (metric === "avg_review" || metric === "late_delivery_rate") {
    const thin = shown.filter((row) => row.orders < THIN_ORDERS).length;
    if (thin > 0) {
      warnings.push(
        `${thin} of the ${shown.length} rows have fewer than ${THIN_ORDERS} orders, so their ${metric === "avg_review" ? "average review" : "late-delivery rate"} is noisy and can sit at the top or bottom by chance.`,
      );
    }
  }

  return {
    group_by: args.group_by,
    metric,
    rows: shown,
    groups,
    total: { orders: totalOrders, revenue: round(totalRevenue, 2) },
    warnings,
    source: OLIST_SOURCE,
  };
}
