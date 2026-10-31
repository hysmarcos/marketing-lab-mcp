/**
 * The numbers behind the small views in "The nine tools". Each function takes the real output of
 * a tool's first example (run in the browser by bento.ts) and keeps only what its view draws.
 * Nothing here is hard-coded: change a tool and its tile changes with it.
 */

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function num(value: unknown, what: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Expected a number for ${what}.`);
  }
  return value;
}

function record(value: unknown, what: string): Json {
  if (!isRecord(value)) throw new Error(`Expected an object for ${what}.`);
  return value;
}

// A/B test: how far apart the two conversion rates really are ---------------------------------

export interface Density {
  rate: number;
  /** Standard error of the rate, sqrt(p (1 - p) / n). */
  sd: number;
  /** Points [x, y] with x in [0, 1] across the shared axis and y in [0, 1] (shared scale). */
  points: [number, number][];
}

export interface AbView {
  control: Density;
  variant: Density;
  /** Axis range in conversion rate. */
  lo: number;
  hi: number;
  probBetter: number;
  relativeLift: number;
}

const SAMPLES = 64;

function normalPdf(x: number, mean: number, sd: number): number {
  const z = (x - mean) / sd;
  return Math.exp(-0.5 * z * z) / (sd * Math.sqrt(2 * Math.PI));
}

/**
 * The uncertainty around each arm's conversion rate, drawn as a bell curve (the normal
 * approximation of its posterior, mean p and standard error sqrt(p (1 - p) / n)). The less the
 * curves overlap, the surer the result; the tool's own `prob_variant_better` is the headline.
 */
export function abView(args: Json, out: Json): AbView {
  const n = (arm: string) => num(record(args[arm], arm).visitors, `${arm}.visitors`);
  const control = num(out.control_rate, "control_rate");
  const variant = num(out.variant_rate, "variant_rate");
  const sdC = Math.sqrt((control * (1 - control)) / n("control"));
  const sdV = Math.sqrt((variant * (1 - variant)) / n("variant"));
  const lo = Math.max(0, Math.min(control - 4 * sdC, variant - 4 * sdV));
  const hi = Math.max(control + 4 * sdC, variant + 4 * sdV);
  const peak = Math.max(normalPdf(control, control, sdC), normalPdf(variant, variant, sdV));
  const curve = (rate: number, sd: number): Density => ({
    rate,
    sd,
    points: Array.from({ length: SAMPLES + 1 }, (_, i) => {
      const x = i / SAMPLES;
      return [x, normalPdf(lo + x * (hi - lo), rate, sd) / peak] as [number, number];
    }),
  });
  return {
    control: curve(control, sdC),
    variant: curve(variant, sdV),
    lo,
    hi,
    probBetter: num(out.prob_variant_better, "prob_variant_better"),
    relativeLift: num(out.relative_lift, "relative_lift"),
  };
}

// E-mail test: the campaign's overall effect -------------------------------------------------

export interface EmailView {
  campaign: string;
  metric: string;
  control: number;
  treatment: number;
  relativeUplift: number;
  significant: boolean;
}

export function emailView(out: Json): EmailView {
  const rows = Array.isArray(out.rows) ? out.rows.filter(isRecord) : [];
  const row = rows.find((r) => r.segment === "all") ?? rows[0];
  if (!row) throw new Error("The e-mail test returned no rows.");
  return {
    campaign: String(out.campaign),
    metric: String(out.metric),
    control: num(row.control_value, "control_value"),
    treatment: num(row.treatment_value, "treatment_value"),
    relativeUplift: num(row.relative_uplift, "relative_uplift"),
    significant: row.significant === true,
  };
}

// Budget: the current split against the optimizer's -----------------------------------------

export interface BudgetShare {
  channel: string;
  current: number;
  optimal: number;
}

export interface BudgetView {
  shares: BudgetShare[];
  /** Weekly total the optimizer spread (the current plan's total by default). */
  totalWeekly: number;
  /** Change in median media-driven sales against the current plan, in percent. */
  pct: number;
}

export function budgetView(simulated: Json, optimized: Json): BudgetView {
  const spend = record(simulated.weekly_spend, "weekly_spend");
  const allocation = record(optimized.allocation, "allocation");
  const channels = Object.keys(spend);
  const sum = (values: Json) => channels.reduce((s, c) => s + num(values[c] ?? 0, c), 0);
  const currentTotal = sum(spend);
  const optimalTotal = sum(allocation);
  return {
    shares: channels.map((channel) => ({
      channel,
      current: num(spend[channel], channel) / currentTotal,
      optimal: num(allocation[channel] ?? 0, channel) / optimalTotal,
    })),
    totalWeekly: num(optimized.total_weekly, "total_weekly"),
    pct: num(record(optimized.vs_current, "vs_current").pct, "vs_current.pct"),
  };
}

// Store sales: the top categories ---------------------------------------------------------------

export interface StoreRow {
  key: string;
  revenue: number;
  /** Revenue relative to the first (largest) row, for the bar length. */
  scale: number;
}

export interface StoreView {
  rows: StoreRow[];
  totalRevenue: number;
  groups: number;
}

export function storeView(out: Json, top = 5): StoreView {
  const rows = (Array.isArray(out.rows) ? out.rows.filter(isRecord) : []).slice(0, top);
  const max = Math.max(...rows.map((r) => num(r.revenue, "revenue")), 0) || 1;
  return {
    rows: rows.map((r) => ({
      key: String(r.key),
      revenue: num(r.revenue, "revenue"),
      scale: num(r.revenue, "revenue") / max,
    })),
    totalRevenue: num(record(out.total, "total").revenue, "total.revenue"),
    groups: num(out.groups, "groups"),
  };
}

// Attribution: the known truth against last touch -------------------------------------------

export interface AttributionRow {
  channel: string;
  truth: number;
  lastTouch: number;
}

export interface AttributionView {
  rows: AttributionRow[];
  /** Mean absolute error of last touch's shares against the truth (a fraction). */
  lastTouchError: number;
  /** Every model's mean absolute error against the truth, closest first. */
  errors: { model: string; error: number }[];
  /** The model that lands closest to the truth, and its error. */
  best: { model: string; error: number };
}

export function attributionView(out: Json): AttributionView {
  const truth = record(out.truth, "truth");
  const models = record(out.models, "models");
  const lastTouch = record(models.last_touch, "models.last_touch");
  const errors = record(out.error_vs_truth, "error_vs_truth");
  const channels = Array.isArray(out.channels) ? out.channels.map(String) : Object.keys(truth);
  const ranked = Object.entries(errors)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort((a, b) => a[1] - b[1]);
  const best = ranked[0];
  if (!best) throw new Error("The attribution result has no model errors.");
  return {
    rows: channels.map((channel) => ({
      channel,
      truth: num(truth[channel], `truth.${channel}`),
      lastTouch: num(record(lastTouch[channel], channel).share, `last_touch.${channel}.share`),
    })),
    lastTouchError: num(errors.last_touch, "error_vs_truth.last_touch"),
    errors: ranked.map(([model, error]) => ({ model, error })),
    best: { model: best[0], error: best[1] },
  };
}
