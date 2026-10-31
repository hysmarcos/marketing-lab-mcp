import { ToolInputError } from "../server/tool";
import { round } from "./query";

export const MAX_JOURNEYS = 5000;
export const MAX_PATH_LENGTH = 20;
export const MAX_CHANNELS = 12;
export const MAX_CHANNEL_NAME = 40;
/** Below this many conversions the differences between models are mostly noise. */
const FEW_CONVERSIONS = 50;

export const MODELS = ["last_touch", "first_touch", "linear", "markov", "shapley"] as const;
export type AttributionModel = (typeof MODELS)[number];

/** A group of users who followed the same path. */
export type Journey = {
  /** Channels in the order they were touched. */
  path: string[];
  conversions: number;
  nulls: number;
};

/** data/journeys_sample.json: simulated journeys with the true share of each channel. */
export type AttributionData = {
  source: string;
  channels: string[];
  truth: Record<string, number>;
  journeys: Journey[];
};

export type ModelCredit = { credit: number; share: number };

export type AttributionResult = {
  channels: string[];
  total_conversions: number;
  models: Record<AttributionModel, Record<string, ModelCredit>>;
  truth: Record<string, number> | null;
  error_vs_truth: Record<AttributionModel, number> | null;
  warnings: string[];
  source: string;
};

export const SAMPLE_SOURCE = "simulated journeys (seed 42), marketing-lab-mcp";
export const USER_SOURCE = "user input";

type Prepared = {
  channels: string[];
  /** Channel index of every touch, per journey. */
  paths: number[][];
  conversions: number[];
  nulls: number[];
  total: number;
};

/** `array[i] += value` for typed arrays under noUncheckedIndexedAccess. */
function add(array: Float64Array, i: number, value: number): void {
  array[i] = (array[i] as number) + value;
}

function isCount(n: unknown): n is number {
  return typeof n === "number" && Number.isInteger(n) && n >= 0;
}

/** Validates the journeys and turns channel names into indexes. `seed` fixes the channel order. */
function prepare(journeys: Journey[], seed: string[]): Prepared {
  if (journeys.length < 1 || journeys.length > MAX_JOURNEYS) {
    throw new ToolInputError(
      `journeys must have between 1 and ${MAX_JOURNEYS} rows; got ${journeys.length}.`,
    );
  }
  const channels = [...seed];
  const index = new Map<string, number>(channels.map((c, i) => [c, i]));
  // Raw name -> channel index, so each distinct spelling is trimmed and checked only once.
  const seen = new Map<string, number>();
  const resolve = (raw: unknown, where: string): number => {
    const name = typeof raw === "string" ? raw.trim() : "";
    if (name === "") {
      throw new ToolInputError(`${where}.path has an empty channel name.`);
    }
    if (name.length > MAX_CHANNEL_NAME) {
      throw new ToolInputError(
        `${where}.path has a channel name longer than ${MAX_CHANNEL_NAME} characters.`,
      );
    }
    let k = index.get(name);
    if (k === undefined) {
      if (channels.length >= MAX_CHANNELS) {
        throw new ToolInputError(
          `journeys use more than ${MAX_CHANNELS} distinct channels. Merge the small ones into a group such as "other".`,
        );
      }
      k = channels.length;
      channels.push(name);
      index.set(name, k);
    }
    return k;
  };
  const paths: number[][] = [];
  const conversions: number[] = [];
  const nulls: number[] = [];
  let total = 0;
  for (let i = 0; i < journeys.length; i++) {
    const j = journeys[i] as Journey;
    const where = `journeys[${i}]`;
    if (!Array.isArray(j.path) || j.path.length < 1 || j.path.length > MAX_PATH_LENGTH) {
      throw new ToolInputError(
        `${where}.path must list between 1 and ${MAX_PATH_LENGTH} channels; got ${Array.isArray(j.path) ? j.path.length : "none"}.`,
      );
    }
    if (!isCount(j.conversions) || !isCount(j.nulls)) {
      throw new ToolInputError(`${where}: conversions and nulls must be whole numbers, 0 or more.`);
    }
    const path: number[] = new Array(j.path.length);
    for (let t = 0; t < j.path.length; t++) {
      const raw = j.path[t] as string;
      let k = seen.get(raw);
      if (k === undefined) {
        k = resolve(raw, where);
        seen.set(raw, k);
      }
      path[t] = k;
    }
    paths.push(path);
    conversions.push(j.conversions);
    nulls.push(j.nulls);
    total += j.conversions;
  }
  return { channels, paths, conversions, nulls, total };
}

/** The whole credit of each conversion goes to the touch that `pick` chooses (first or last). */
function singleTouch(p: Prepared, pick: (path: number[]) => number): Float64Array {
  const credit = new Float64Array(p.channels.length);
  for (let i = 0; i < p.paths.length; i++) {
    const c = p.conversions[i] as number;
    if (c > 0) add(credit, pick(p.paths[i] as number[]), c);
  }
  return credit;
}

/** Each conversion is split equally over every touch, repeats included. */
function linearCredit(p: Prepared): Float64Array {
  const credit = new Float64Array(p.channels.length);
  for (let i = 0; i < p.paths.length; i++) {
    const c = p.conversions[i] as number;
    if (c === 0) continue;
    const path = p.paths[i] as number[];
    const each = c / path.length;
    for (const k of path) add(credit, k, each);
  }
  return credit;
}

/** Solves A x = b by Gaussian elimination with partial pivoting. Changes `a` and `b`. */
function solve(a: Float64Array, b: Float64Array, n: number): Float64Array {
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(a[col * n + col] as number);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(a[r * n + col] as number);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (best < 1e-14) continue;
    if (pivot !== col) {
      for (let k = 0; k < n; k++) {
        const t = a[col * n + k] as number;
        a[col * n + k] = a[pivot * n + k] as number;
        a[pivot * n + k] = t;
      }
      const t = b[col] as number;
      b[col] = b[pivot] as number;
      b[pivot] = t;
    }
    const d = a[col * n + col] as number;
    for (let r = col + 1; r < n; r++) {
      const f = (a[r * n + col] as number) / d;
      if (f === 0) continue;
      for (let k = col; k < n; k++) {
        a[r * n + k] = (a[r * n + k] as number) - f * (a[col * n + k] as number);
      }
      b[r] = (b[r] as number) - f * (b[col] as number);
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = b[r] as number;
    for (let k = r + 1; k < n; k++) s -= (a[r * n + k] as number) * (x[k] as number);
    const d = a[r * n + r] as number;
    x[r] = Math.abs(d) < 1e-14 ? 0 : s / d;
  }
  return x;
}

/**
 * First-order Markov chain with start, the channels, conv and null. A journey with c conversions
 * and n nulls adds c paths that end in conv and n that end in null. The credit of a channel is
 * the total conversions times its removal effect over the sum of all removal effects, where
 * removing a channel sends its node to null.
 */
function markovCredit(p: Prepared): Float64Array {
  const k = p.channels.length;
  const n = k + 1; // transient states: channels 0..k-1 and start = k
  const start = k;
  const move = new Float64Array(n * n);
  const toConv = new Float64Array(n);
  const toNull = new Float64Array(n);
  for (let i = 0; i < p.paths.length; i++) {
    const c = p.conversions[i] as number;
    const nl = p.nulls[i] as number;
    const w = c + nl;
    if (w === 0) continue;
    let prev = start;
    for (const ch of p.paths[i] as number[]) {
      if (ch === prev) continue; // consecutive repeats collapse
      add(move, prev * n + ch, w);
      prev = ch;
    }
    add(toConv, prev, c);
    add(toNull, prev, nl);
  }
  for (let s = 0; s < n; s++) {
    let sum = (toConv[s] as number) + (toNull[s] as number);
    for (let t = 0; t < n; t++) sum += move[s * n + t] as number;
    if (sum === 0) continue;
    for (let t = 0; t < n; t++) move[s * n + t] = (move[s * n + t] as number) / sum;
    toConv[s] = (toConv[s] as number) / sum;
  }
  const conversionProbability = (removed: number): number => {
    const a = new Float64Array(n * n);
    const b = new Float64Array(n);
    for (let s = 0; s < n; s++) {
      a[s * n + s] = 1;
      if (s === removed) continue;
      for (let t = 0; t < n; t++) add(a, s * n + t, -(move[s * n + t] as number));
      b[s] = toConv[s] as number;
    }
    return solve(a, b, n)[start] as number;
  };
  const base = conversionProbability(-1);
  const effect = new Float64Array(k);
  let sum = 0;
  for (let c = 0; c < k; c++) {
    effect[c] = base > 0 ? Math.max(0, 1 - conversionProbability(c) / base) : 0;
    sum += effect[c] as number;
  }
  const credit = new Float64Array(k);
  if (sum > 0) for (let c = 0; c < k; c++) credit[c] = (p.total * (effect[c] as number)) / sum;
  return credit;
}

/**
 * Exact Shapley values. The worth of a set of channels S is the number of conversions of the
 * journeys that touched only channels in S.
 */
function shapleyCredit(p: Prepared): Float64Array {
  const k = p.channels.length;
  const size = 1 << k;
  const worth = new Float64Array(size);
  for (let i = 0; i < p.paths.length; i++) {
    let mask = 0;
    for (const ch of p.paths[i] as number[]) mask |= 1 << ch;
    add(worth, mask, p.conversions[i] as number);
  }
  // Subset-sum transform: worth[S] becomes the conversions of journeys whose channels are all in S.
  for (let bit = 0; bit < k; bit++) {
    const b = 1 << bit;
    for (let mask = 0; mask < size; mask++) {
      if (mask & b) add(worth, mask, worth[mask ^ b] as number);
    }
  }
  const factorial = [1];
  for (let i = 1; i <= k; i++) factorial.push((factorial[i - 1] as number) * i);
  const weight: number[] = [];
  for (let s = 0; s < k; s++) {
    weight.push(
      ((factorial[s] as number) * (factorial[k - s - 1] as number)) / (factorial[k] as number),
    );
  }
  const popcount = new Uint8Array(size);
  for (let mask = 1; mask < size; mask++) {
    popcount[mask] = (popcount[mask >> 1] as number) + (mask & 1);
  }
  const credit = new Float64Array(k);
  for (let c = 0; c < k; c++) {
    const b = 1 << c;
    let sum = 0;
    for (let mask = 0; mask < size; mask++) {
      if (mask & b) continue;
      const gain = (worth[mask | b] as number) - (worth[mask] as number);
      sum += (weight[popcount[mask] as number] as number) * gain;
    }
    credit[c] = sum;
  }
  return credit;
}

function toCredits(
  channels: string[],
  credit: Float64Array,
  total: number,
): Record<string, ModelCredit> {
  const out: Record<string, ModelCredit> = {};
  channels.forEach((name, i) => {
    const c = credit[i] as number;
    out[name] = { credit: round(c, 4), share: total > 0 ? round(c / total, 6) : 0 };
  });
  return out;
}

/** Compares five attribution models on the user's journeys, or on the simulated sample. */
export function compareAttribution(
  args: { journeys?: Journey[] },
  sample: AttributionData,
): AttributionResult {
  const useSample = args.journeys === undefined;
  const p = prepare(args.journeys ?? sample.journeys, useSample ? sample.channels : []);
  const warnings: string[] = [];
  const empty = () => new Float64Array(p.channels.length);
  const credits: Record<AttributionModel, Float64Array> =
    p.total === 0
      ? {
          last_touch: empty(),
          first_touch: empty(),
          linear: empty(),
          markov: empty(),
          shapley: empty(),
        }
      : {
          last_touch: singleTouch(p, (path) => path[path.length - 1] as number),
          first_touch: singleTouch(p, (path) => path[0] as number),
          linear: linearCredit(p),
          markov: markovCredit(p),
          shapley: shapleyCredit(p),
        };
  if (p.total === 0) {
    warnings.push("There are no conversions in the journeys, so every channel gets 0 credit.");
  } else if (p.total < FEW_CONVERSIONS) {
    warnings.push(
      `Only ${p.total} conversions: differences between the models are mostly noise at this size.`,
    );
  }
  if (p.channels.length === 1) {
    warnings.push("There is one channel, so every model gives it all the credit.");
  }
  const models = {} as Record<AttributionModel, Record<string, ModelCredit>>;
  for (const m of MODELS) models[m] = toCredits(p.channels, credits[m], p.total);

  let truth: Record<string, number> | null = null;
  let errors: Record<AttributionModel, number> | null = null;
  if (useSample) {
    truth = {};
    for (const c of p.channels) truth[c] = round(sample.truth[c] ?? 0, 6);
    errors = {} as Record<AttributionModel, number>;
    for (const m of MODELS) {
      let sum = 0;
      p.channels.forEach((c, i) => {
        const share = p.total > 0 ? (credits[m][i] as number) / p.total : 0;
        sum += Math.abs(share - (sample.truth[c] ?? 0));
      });
      errors[m] = round(sum / p.channels.length, 6);
    }
  }
  return {
    channels: p.channels,
    total_conversions: p.total,
    models,
    truth,
    error_vs_truth: errors,
    warnings,
    source: useSample ? SAMPLE_SOURCE : USER_SOURCE,
  };
}
