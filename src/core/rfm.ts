import { ToolInputError } from "../server/tool";
import { round } from "./query";
import { OLIST_SOURCE } from "./store";

export const SEGMENTS = [
  "champions",
  "loyal",
  "big_spenders_new",
  "recent",
  "needs_attention",
  "at_risk_high_value",
  "hibernating",
] as const;
export type Segment = (typeof SEGMENTS)[number];

/** data/olist_rfm.json: customers, revenue and averages per state and segment. */
export type RfmData = {
  source: string;
  license: string;
  as_of: string;
  rules: string[];
  summary: {
    state: string;
    segment: Segment;
    customers: number;
    revenue: number;
    avg_recency_days: number;
    avg_orders: number;
    avg_monetary: number;
  }[];
};

export type RfmCustomer = {
  customer_id: string;
  /** YYYY-MM-DD */
  last_order_date: string;
  orders: number;
  revenue: number;
};

export type ScoredCustomer = RfmCustomer & {
  recency_days: number;
  r_score: number;
  f_score: number;
  m_score: number;
  segment: Segment;
};

export type RfmSegmentRow = {
  segment: Segment;
  customers: number;
  /** Fraction of all customers in the population (after the state filter, before the segment filter). */
  share: number;
  revenue: number;
  avg_recency_days: number;
  avg_orders: number;
  avg_monetary: number;
};

export type RfmResult = {
  mode: "olist" | "custom";
  as_of: string;
  /** Customers in the population the shares are measured against. */
  total_customers: number;
  segments: RfmSegmentRow[];
  rules: string[];
  warnings: string[];
  source: string;
};

export const MAX_CUSTOMERS = 2000;
const MIN_FOR_QUINTILES = 5;
const DAY_MS = 86_400_000;
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const CUSTOM_RULES = [
  "R = whole days from the customer's last_order_date to as_of. F = number of orders. M = revenue.",
  "R score: customers are ranked by R ascending (ties in input order) and cut into 5 equal-sized groups, then reversed, so R=5 is the most recent fifth.",
  "M score: customers are ranked by M ascending (ties in input order) and cut into 5 equal-sized groups, so M=5 is the highest-spending fifth.",
  "F score: 1 order -> 1, 2 orders -> 3, 3 or more orders -> 5.",
  "Segment, first match wins: champions (R>=4 and F>=3), loyal (F>=3), big_spenders_new (R>=4 and M=5), recent (R>=4), needs_attention (R=3), at_risk_high_value (R<=2 and M>=4), hibernating (otherwise).",
  "The groups are cut inside the customers you sent, so scores are relative to your own list.",
];

/**
 * Zero-based quintile of a 1-based rank among n customers, the same cut as pandas
 * `qcut(rank, 5)`: the bin is the smallest k in 1..5 with 5 * (rank - 1) <= (n - 1) * k.
 * Integer arithmetic only, so there are no floating-point edges.
 */
export function quintileBin(rank: number, n: number): number {
  if (n <= 1) return 0;
  const k = Math.floor((5 * (rank - 1) + n - 2) / (n - 1));
  return Math.max(1, k) - 1;
}

/**
 * Quintile of each value, ranking ascending with ties broken by input order (pandas
 * `rank(method="first")`). A numeric typed-array sort finds where each distinct value starts;
 * equal values then take consecutive ranks in input order. `tiesSplit` is true when equal values
 * ended up in different quintiles, which is when the input order changes a score.
 */
function rankBins(values: number[]): { bins: number[]; tiesSplit: boolean } {
  const n = values.length;
  const sorted = Float64Array.from(values).sort();
  const nextRank = new Map<number, number>();
  for (let pos = 0; pos < n; pos++) {
    const v = sorted[pos] as number;
    if (pos === 0 || v !== sorted[pos - 1]) nextRank.set(v, pos + 1);
  }
  const firstBin = new Map<number, number>();
  let tiesSplit = false;
  const bins = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const v = values[i] as number;
    const rank = nextRank.get(v) as number;
    nextRank.set(v, rank + 1);
    const bin = quintileBin(rank, n);
    const seen = firstBin.get(v);
    if (seen === undefined) firstBin.set(v, bin);
    else if (seen !== bin) tiesSplit = true;
    bins[i] = bin;
  }
  return { bins, tiesSplit };
}

export function frequencyScore(orders: number): number {
  if (orders >= 3) return 5;
  return orders === 2 ? 3 : 1;
}

export function segmentFor(r: number, f: number, m: number): Segment {
  if (r >= 4 && f >= 3) return "champions";
  if (f >= 3) return "loyal";
  if (r >= 4 && m === 5) return "big_spenders_new";
  if (r >= 4) return "recent";
  if (r === 3) return "needs_attention";
  if (r <= 2 && m >= 4) return "at_risk_high_value";
  return "hibernating";
}

function digits(value: string, start: number, length: number): number {
  let n = 0;
  for (let i = start; i < start + length; i++) {
    const c = value.charCodeAt(i) - 48;
    if (c < 0 || c > 9) return Number.NaN;
    n = n * 10 + c;
  }
  return n;
}

/**
 * Days since 1970-01-01 of a YYYY-MM-DD calendar date (proleptic Gregorian, no Date object), or a
 * ToolInputError naming the field.
 */
function parseDay(value: string, field: string, customerId?: string): number {
  if (value.length === 10 && value[4] === "-" && value[7] === "-") {
    const year = digits(value, 0, 4);
    const month = digits(value, 5, 2);
    const day = digits(value, 8, 2);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const monthLength = (DAYS_IN_MONTH[month - 1] ?? 0) + (month === 2 && leap ? 1 : 0);
    if (day >= 1 && day <= monthLength) {
      // days_from_civil: the year starts in March so the leap day is the last day of the year.
      const y = month <= 2 ? year - 1 : year;
      const era = Math.floor(y / 400);
      const yoe = y - era * 400;
      const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
      const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
      return era * 146097 + doe - 719468;
    }
  }
  const label = customerId === undefined ? field : `Customer '${customerId}' ${field}`;
  throw new ToolInputError(`${label} must be a valid date in YYYY-MM-DD format, got '${value}'.`);
}

function formatDay(days: number): string {
  return new Date(days * DAY_MS).toISOString().slice(0, 10);
}

function validateCustomers(customers: RfmCustomer[]): void {
  if (customers.length === 0) {
    throw new ToolInputError("customers must contain at least one customer.");
  }
  if (customers.length > MAX_CUSTOMERS) {
    throw new ToolInputError(
      `customers has ${customers.length} entries; the limit is ${MAX_CUSTOMERS}.`,
    );
  }
  const ids = new Set<string>();
  for (const c of customers) {
    if (typeof c.customer_id !== "string" || c.customer_id === "") {
      throw new ToolInputError("Every customer needs a non-empty customer_id.");
    }
    if (ids.has(c.customer_id)) {
      throw new ToolInputError(`customer_id '${c.customer_id}' appears more than once.`);
    }
    ids.add(c.customer_id);
    if (!Number.isInteger(c.orders) || c.orders < 1) {
      throw new ToolInputError(
        `Customer '${c.customer_id}': orders must be a whole number of at least 1.`,
      );
    }
    if (!Number.isFinite(c.revenue) || c.revenue < 0) {
      throw new ToolInputError(`Customer '${c.customer_id}': revenue must be 0 or more.`);
    }
  }
}

/** Parses every last_order_date once per distinct string (lists usually repeat dates). */
function parseLastDays(customers: RfmCustomer[]): number[] {
  const cache = new Map<string, number>();
  return customers.map((c) => {
    let day = cache.get(c.last_order_date);
    if (day === undefined) {
      day = parseDay(c.last_order_date, "last_order_date", c.customer_id);
      cache.set(c.last_order_date, day);
    }
    return day;
  });
}

/**
 * Scores customers with the Task 5 rules: R and M quintiles inside the list (ties in input order),
 * F from the order count. The result is in input order.
 */
export function scoreCustomers(customers: RfmCustomer[], asOf: string): ScoredCustomer[] {
  return scoreWithDays(customers, parseLastDays(customers), asOf).scored;
}

/** `lastDays[i]` is the parsed last_order_date of `customers[i]` (see parseDay). */
function scoreWithDays(
  customers: RfmCustomer[],
  lastDays: number[],
  asOf: string,
): { scored: ScoredCustomer[]; tiesSplit: boolean } {
  const asOfDay = parseDay(asOf, "as_of");
  const recency = lastDays.map((day, i) => {
    const days = asOfDay - day;
    if (days < 0) {
      const c = customers[i] as RfmCustomer;
      throw new ToolInputError(
        `Customer '${c.customer_id}' has last_order_date ${c.last_order_date} after as_of ${asOf}.`,
      );
    }
    return days;
  });
  const recencyRank = rankBins(recency);
  const moneyRank = rankBins(customers.map((c) => c.revenue));
  const scored = customers.map((c, i) => {
    const r = 5 - (recencyRank.bins[i] as number);
    const f = frequencyScore(c.orders);
    const m = 1 + (moneyRank.bins[i] as number);
    return {
      customer_id: c.customer_id,
      last_order_date: c.last_order_date,
      orders: c.orders,
      revenue: c.revenue,
      recency_days: recency[i] as number,
      r_score: r,
      f_score: f,
      m_score: m,
      segment: segmentFor(r, f, m),
    };
  });
  return { scored, tiesSplit: recencyRank.tiesSplit || moneyRank.tiesSplit };
}

type Totals = { customers: number; revenue: number; recency: number; orders: number };

function emptyTotals(): Totals {
  return { customers: 0, revenue: 0, recency: 0, orders: 0 };
}

/** Turns per-segment sums (recency and orders summed over customers) into output rows. */
function toRows(
  bySegment: Map<Segment, Totals>,
  population: number,
  only: Segment | undefined,
): RfmSegmentRow[] {
  const rows: RfmSegmentRow[] = [];
  for (const segment of SEGMENTS) {
    if (only !== undefined && segment !== only) continue;
    const t = bySegment.get(segment);
    if (!t || t.customers === 0) continue;
    rows.push({
      segment,
      customers: t.customers,
      share: t.customers / population,
      revenue: round(t.revenue, 2),
      avg_recency_days: round(t.recency / t.customers, 1),
      avg_orders: round(t.orders / t.customers, 3),
      avg_monetary: round(t.revenue / t.customers, 2),
    });
  }
  return rows;
}

function queryCustom(
  customers: RfmCustomer[],
  asOfArg: string | undefined,
  segment: Segment | undefined,
): RfmResult {
  validateCustomers(customers);
  const lastDays = parseLastDays(customers);
  let latest = lastDays[0] as number;
  for (const d of lastDays) if (d > latest) latest = d;
  const asOf = asOfArg ?? formatDay(latest + 1);
  const { scored, tiesSplit } = scoreWithDays(customers, lastDays, asOf);

  const bySegment = new Map<Segment, Totals>();
  for (const c of scored) {
    const t = bySegment.get(c.segment) ?? emptyTotals();
    t.customers += 1;
    t.revenue += c.revenue;
    t.recency += c.recency_days;
    t.orders += c.orders;
    bySegment.set(c.segment, t);
  }

  const warnings: string[] = [];
  if (scored.length < MIN_FOR_QUINTILES) {
    warnings.push(
      `Only ${scored.length} customer(s), fewer than ${MIN_FOR_QUINTILES}: quintiles are not meaningful, so the R and M scores and segments below are arbitrary.`,
    );
  } else if (tiesSplit) {
    warnings.push(
      "Customers with the same last_order_date or revenue straddle a score boundary. Ties are ranked in input order, so reordering the list can change their R or M scores.",
    );
  }
  if (asOfArg === undefined) {
    warnings.push(`as_of was not given, so it is the day after the latest order: ${asOf}.`);
  }

  return {
    mode: "custom",
    as_of: asOf,
    total_customers: scored.length,
    segments: toRows(bySegment, scored.length, segment),
    rules: CUSTOM_RULES,
    warnings,
    source: "user input",
  };
}

function queryOlist(
  data: RfmData,
  state: string | undefined,
  segment: Segment | undefined,
): RfmResult {
  const base = { mode: "olist" as const, as_of: data.as_of, rules: data.rules };
  const warnings: string[] = [];
  let rows = data.summary;
  if (state !== undefined) {
    const wanted = state.trim().toUpperCase();
    rows = rows.filter((r) => r.state === wanted);
    if (rows.length === 0) {
      const valid = [...new Set(data.summary.map((r) => r.state))].sort();
      warnings.push(`Unknown state '${state}'. Valid states: ${valid.join(", ")}.`);
      return { ...base, total_customers: 0, segments: [], warnings, source: OLIST_SOURCE };
    }
  }

  const bySegment = new Map<Segment, Totals>();
  let population = 0;
  for (const r of rows) {
    const t = bySegment.get(r.segment) ?? emptyTotals();
    t.customers += r.customers;
    t.revenue += r.revenue;
    t.recency += r.customers * r.avg_recency_days;
    t.orders += r.customers * r.avg_orders;
    bySegment.set(r.segment, t);
    population += r.customers;
  }
  return {
    ...base,
    total_customers: population,
    segments: toRows(bySegment, population, segment),
    warnings,
    source: OLIST_SOURCE,
  };
}

export function queryRfm(
  data: RfmData,
  args: { state?: string; segment?: Segment; customers?: RfmCustomer[]; as_of?: string },
): RfmResult {
  let result: RfmResult;
  if (args.customers !== undefined) {
    if (args.state !== undefined) {
      throw new ToolInputError(
        "state only applies to the Olist data; leave it out when you send customers.",
      );
    }
    result = queryCustom(args.customers, args.as_of, args.segment);
  } else {
    if (args.as_of !== undefined) {
      throw new ToolInputError(
        `as_of only applies to the customers you send; the Olist data is fixed at ${data.as_of}.`,
      );
    }
    result = queryOlist(data, args.state, args.segment);
  }
  if (args.segment !== undefined && result.segments.length === 0 && result.total_customers > 0) {
    result.warnings.push(`No customers fall in the '${args.segment}' segment here.`);
  }
  return result;
}
