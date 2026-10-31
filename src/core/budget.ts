import { ToolInputError } from "../server/tool";

/** Channel keys as they appear in data/mmm_results.json. */
export const CHANNELS = ["tv_S", "ooh_S", "print_S", "facebook_S", "search_S"] as const;
export type Channel = (typeof CHANNELS)[number];

/** Names shown to users (and used in outputs). */
export const SHORT_NAMES = ["tv", "ooh", "print", "facebook", "search"] as const;
export type ShortChannel = (typeof SHORT_NAMES)[number];
const SHORT: Record<Channel, ShortChannel> = {
  tv_S: "tv",
  ooh_S: "ooh",
  print_S: "print",
  facebook_S: "facebook",
  search_S: "search",
};

export const SOURCE =
  "Bayesian MMM (PyMC-Marketing) fitted on Meta Robyn's simulated demo data (MIT), via github.com/hysmarcos/marketing-mix-model";

/** The part of the results file the simulator needs (the test fixture ships only this). */
export type MmmCore = {
  meta: { horizon_weeks: number };
  channels: Channel[];
  /** Last `l_max - 1` weeks of real spend per channel, oldest first. */
  history: Record<Channel, number[]>;
  scales: { channel: Record<Channel, number>; target: number };
  draws: {
    lam: Record<Channel, number[]>;
    beta: Record<Channel, number[]>;
    alpha: Record<Channel, number[]>;
    baseline_weekly: number[];
  };
};

/** data/mmm_results.json, as far as this module reads it. */
export type MmmResults = MmmCore & {
  spend_max_weekly: Record<Channel, number>;
  plans: { current: Record<Channel, number>; optimal: Record<Channel, number> };
};

export type Band = { median: number; p05: number; p95: number };
export type Plan = Record<Channel, number>;

export function logistic(z: number): number {
  const e = Math.exp(-z);
  return (1 - e) / (1 + e);
}

/** Same as numpy.percentile with linear interpolation. */
export function percentile(values: number[], p: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(rank);
  const upper = Math.ceil(rank);
  const lo = sorted[lower] as number;
  const hi = sorted[upper] as number;
  return lo + (hi - lo) * (rank - lower);
}

export function band(values: number[]): Band {
  // Sorting once is enough: percentile() on an already sorted copy gives the same numbers.
  const sorted = [...values].sort((a, b) => a - b);
  return {
    median: percentile(sorted, 50),
    p05: percentile(sorted, 5),
    p95: percentile(sorted, 95),
  };
}

/** Normalized geometric adstock weights: alpha^l / sum, for l = 0..lMax-1. */
export function adstockWeights(alpha: number, lMax: number): number[] {
  const w = Array.from({ length: lMax }, (_, l) => alpha ** l);
  const sum = w.reduce((a, b) => a + b, 0);
  return w.map((v) => v / sum);
}

/**
 * Adstocked spend in each future week. `history` holds the last lMax-1 real weeks, oldest
 * first; from the first future week on, `spend` is invested every week.
 */
export function adstockedSpend(
  alpha: number,
  history: number[],
  spend: number,
  weeks: number,
): number[] {
  const lMax = history.length + 1;
  const w = adstockWeights(alpha, lMax);
  const series = [...history, ...new Array<number>(weeks).fill(spend)];
  return Array.from({ length: weeks }, (_, t) => {
    let x = 0;
    for (let lag = 0; lag < lMax; lag++) {
      x += (w[lag] as number) * (series[history.length + t - lag] as number);
    }
    return x;
  });
}

/**
 * Same numbers as `adstockedSpend`, split so that the adstocked spend of week t is
 * `a[t] * spend + b[t]`: `a` is the weight that falls on the future (constant) spend and `b`
 * the part that comes from the real history. It lets the optimizer try many spend levels
 * without redoing the convolution, and avoids allocating in the simulator's inner loop.
 */
export function adstockCoefficients(
  alpha: number,
  history: number[],
  weeks: number,
  w: Float64Array,
  a: Float64Array,
  b: Float64Array,
): void {
  const h = history.length;
  const lMax = h + 1;
  let sum = 0;
  for (let l = 0; l < lMax; l++) {
    const v = alpha ** l;
    w[l] = v;
    sum += v;
  }
  for (let l = 0; l < lMax; l++) w[l] = (w[l] as number) / sum;
  for (let t = 0; t < weeks; t++) {
    let at = 0;
    let bt = 0;
    for (let lag = 0; lag < lMax; lag++) {
      const idx = h + t - lag;
      if (idx >= h) at += w[lag] as number;
      else bt += (w[lag] as number) * (history[idx] as number);
    }
    a[t] = at;
    b[t] = bt;
  }
}

/** Number of adstock weights per channel (the longest history plus the current week). */
function maxLags(results: MmmCore): number {
  return Math.max(...results.channels.map((c) => results.history[c].length)) + 1;
}

/** Media-driven sales over the whole horizon, one value per posterior draw. */
export function mediaDraws(results: MmmCore, plan: Plan): number[] {
  const { draws, scales, channels, history } = results;
  const weeks = results.meta.horizon_weeks;
  const n = draws.baseline_weekly.length;
  const media = new Array<number>(n).fill(0);
  const w = new Float64Array(maxLags(results));
  const a = new Float64Array(weeks);
  const b = new Float64Array(weeks);
  for (const c of channels) {
    const alpha = draws.alpha[c];
    const beta = draws.beta[c];
    const lam = draws.lam[c];
    const spend = plan[c];
    const scale = scales.channel[c];
    const hist = history[c];
    for (let i = 0; i < n; i++) {
      adstockCoefficients(alpha[i] as number, hist, weeks, w, a, b);
      const k = scales.target * (beta[i] as number);
      const l = lam[i] as number;
      let m = 0;
      for (let t = 0; t < weeks; t++) {
        m += k * logistic((l * ((a[t] as number) * spend + (b[t] as number))) / scale);
      }
      media[i] = (media[i] as number) + m;
    }
  }
  return media;
}

export function simulatePlan(results: MmmCore, plan: Plan): { media: Band; total: Band } {
  const weeks = results.meta.horizon_weeks;
  const media = mediaDraws(results, plan);
  const total = media.map((v, i) => v + weeks * (results.draws.baseline_weekly[i] as number));
  return { media: band(media), total: band(total) };
}

// ---------------------------------------------------------------------------
// Input handling

const VALID = `${SHORT_NAMES.join(", ")}`;

function toChannel(key: string, where: string): Channel {
  const k = key.trim().toLowerCase();
  const long = k.endsWith("_s") ? k : `${k}_s`;
  const idx = CHANNELS.findIndex((c) => c.toLowerCase() === long);
  if (idx < 0) {
    throw new ToolInputError(
      `Unknown channel '${key}' in ${where}. Valid channels: ${VALID} (a '_S' suffix is also accepted, e.g. 'tv_S').`,
    );
  }
  return CHANNELS[idx] as Channel;
}

function parseChannelValues(
  input: Record<string, number | undefined> | undefined,
  where: string,
): Partial<Record<Channel, number>> {
  const out: Partial<Record<Channel, number>> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (value === undefined) continue;
    const channel = toChannel(key, where);
    if (!Number.isFinite(value) || value < 0) {
      throw new ToolInputError(
        `'${key}' in ${where} must be a number of 0 or more (dollars per week); got ${value}. Valid channels: ${VALID}.`,
      );
    }
    if (out[channel] !== undefined) {
      throw new ToolInputError(
        `Channel '${channel}' appears twice in ${where} (e.g. as 'tv' and 'tv_S').`,
      );
    }
    out[channel] = value;
  }
  return out;
}

function shortKeys<T>(byChannel: Record<Channel, T>): Record<ShortChannel, T> {
  return {
    tv: byChannel.tv_S,
    ooh: byChannel.ooh_S,
    print: byChannel.print_S,
    facebook: byChannel.facebook_S,
    search: byChannel.search_S,
  };
}

/** Whole dollars with thousands separators, e.g. "$41,112". */
export function money(x: number): string {
  return `${x < 0 ? "-" : ""}$${Math.round(Math.abs(x)).toLocaleString("en-US")}`;
}

function outOfRange(results: MmmResults, plan: Plan): Channel[] {
  return CHANNELS.filter((c) => plan[c] > results.spend_max_weekly[c]);
}

function rangeWarnings(results: MmmResults, plan: Plan, channels: Channel[]): string[] {
  return channels.map(
    (c) =>
      `${SHORT[c]}: ${money(plan[c])} per week is above the highest weekly spend in the data (${money(results.spend_max_weekly[c])}), so the model is extrapolating and this channel's effect is unreliable.`,
  );
}

export type VsCurrent = { media_sales_diff_median: number; pct: number };

function versus(current: Band, plan: Band): VsCurrent {
  const diff = plan.median - current.median;
  return {
    media_sales_diff_median: diff,
    pct: current.median === 0 ? 0 : (diff / current.median) * 100,
  };
}

const currentBandCache = new WeakMap<object, Band>();

function currentBand(results: MmmResults): Band {
  let b = currentBandCache.get(results);
  if (!b) {
    b = simulatePlan(results, results.plans.current).media;
    currentBandCache.set(results, b);
  }
  return b;
}

// ---------------------------------------------------------------------------
// Simulator

export type SimulateResult = {
  weekly_spend: Record<ShortChannel, number>;
  horizon_weeks: number;
  media_sales: Band;
  vs_current: VsCurrent;
  out_of_range: ShortChannel[];
  warnings: string[];
  source: string;
};

export function simulateBudget(
  results: MmmResults,
  args: { weekly_spend?: Record<string, number | undefined> },
): SimulateResult {
  const given = parseChannelValues(args.weekly_spend, "weekly_spend");
  const plan = {} as Plan;
  for (const c of CHANNELS) plan[c] = given[c] ?? results.plans.current[c];

  const flagged = outOfRange(results, plan);
  const media = simulatePlan(results, plan).media;
  return {
    weekly_spend: shortKeys(plan),
    horizon_weeks: results.meta.horizon_weeks,
    media_sales: media,
    vs_current: versus(currentBand(results), media),
    out_of_range: flagged.map((c) => SHORT[c]),
    warnings: rangeWarnings(results, plan, flagged),
    source: SOURCE,
  };
}

// ---------------------------------------------------------------------------
// Optimizer

const STEPS = 200;
const DEFAULT_MAX_FACTOR = 1.5;
const TOTAL_CAP_FACTOR = 5;

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

export type OptimizeResult = {
  allocation: Record<ShortChannel, number>;
  total_weekly: number;
  horizon_weeks: number;
  media_sales: Band;
  vs_current: VsCurrent;
  out_of_range: ShortChannel[];
  warnings: string[];
  source: string;
};

export function optimizeBudget(
  results: MmmResults,
  args: {
    total_weekly?: number;
    min?: Record<string, number | undefined>;
    max?: Record<string, number | undefined>;
  },
): OptimizeResult {
  const currentTotal = CHANNELS.reduce((s, c) => s + results.plans.current[c], 0);
  const total = args.total_weekly ?? currentTotal;
  if (!Number.isFinite(total) || total <= 0) {
    throw new ToolInputError(
      `total_weekly must be a positive number of dollars per week; got ${total}.`,
    );
  }
  if (total > TOTAL_CAP_FACTOR * currentTotal) {
    throw new ToolInputError(
      `total_weekly ${money(total)} is above the limit of ${money(TOTAL_CAP_FACTOR * currentTotal)} (5 times the current weekly total of ${money(currentTotal)}); the model has no evidence out there.`,
    );
  }

  const minGiven = parseChannelValues(args.min, "min");
  const maxGiven = parseChannelValues(args.max, "max");
  const lo = {} as Plan;
  const hi = {} as Plan;
  for (const c of CHANNELS) {
    lo[c] = minGiven[c] ?? 0;
    hi[c] = maxGiven[c] ?? DEFAULT_MAX_FACTOR * results.spend_max_weekly[c];
    if (lo[c] > hi[c]) {
      throw new ToolInputError(
        `min for '${SHORT[c]}' (${money(lo[c])}) is above its max (${money(hi[c])}).`,
      );
    }
  }
  const sumLo = CHANNELS.reduce((s, c) => s + lo[c], 0);
  const sumHi = CHANNELS.reduce((s, c) => s + hi[c], 0);
  if (sumLo > total) {
    throw new ToolInputError(
      `The minimums add up to ${money(sumLo)} per week, more than total_weekly (${money(total)}).`,
    );
  }
  if (sumHi < total) {
    throw new ToolInputError(
      `The maximums add up to ${money(sumHi)} per week, less than total_weekly (${money(total)}), so the budget cannot be placed.`,
    );
  }

  // Greedy marginal allocation on posterior-mean parameters. Channels are independent given
  // their parameters, so the value of a channel depends only on its own weekly spend.
  const weeks = results.meta.horizon_weeks;
  const w = new Float64Array(maxLags(results));
  const params = CHANNELS.map((c) => {
    const a = new Float64Array(weeks);
    const b = new Float64Array(weeks);
    adstockCoefficients(mean(results.draws.alpha[c]), results.history[c], weeks, w, a, b);
    return {
      a,
      b,
      k: results.scales.target * mean(results.draws.beta[c]),
      lam: mean(results.draws.lam[c]),
      scale: results.scales.channel[c],
    };
  });
  const value = (k: number, spend: number): number => {
    const p = params[k] as (typeof params)[number];
    let v = 0;
    for (let t = 0; t < weeks; t++) {
      v += p.k * logistic((p.lam * ((p.a[t] as number) * spend + (p.b[t] as number))) / p.scale);
    }
    return v;
  };

  const spend = CHANNELS.map((c) => lo[c]);
  const current = spend.map((s, k) => value(k, s));
  const step = (total - sumLo) / STEPS;
  let remaining = total - sumLo;
  // A channel that hits its max takes a partial step, so allow a few extra rounds.
  for (let round = 0; round < STEPS + CHANNELS.length && remaining > 1e-9; round++) {
    let best = -1;
    let bestRate = Number.NEGATIVE_INFINITY;
    let bestValue = 0;
    let bestAdd = 0;
    for (let k = 0; k < CHANNELS.length; k++) {
      const room = hi[CHANNELS[k] as Channel] - (spend[k] as number);
      const add = Math.min(step, room, remaining);
      if (add <= 0) continue;
      const v = value(k, (spend[k] as number) + add);
      const rate = (v - (current[k] as number)) / add;
      if (rate > bestRate) {
        best = k;
        bestRate = rate;
        bestValue = v;
        bestAdd = add;
      }
    }
    if (best < 0) break;
    spend[best] = (spend[best] as number) + bestAdd;
    remaining -= bestAdd;
    current[best] = bestValue;
  }

  const plan = {} as Plan;
  CHANNELS.forEach((c, k) => {
    plan[c] = Math.round((spend[k] as number) * 100) / 100;
  });

  const flagged = outOfRange(results, plan);
  const media = simulatePlan(results, plan).media;
  return {
    allocation: shortKeys(plan),
    total_weekly: CHANNELS.reduce((s, c) => s + plan[c], 0),
    horizon_weeks: weeks,
    media_sales: media,
    vs_current: versus(currentBand(results), media),
    out_of_range: flagged.map((c) => SHORT[c]),
    warnings: rangeWarnings(results, plan, flagged),
    source: SOURCE,
  };
}
