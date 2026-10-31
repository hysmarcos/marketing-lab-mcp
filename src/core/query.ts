import { ToolInputError } from "../server/tool";

/** A calendar month as YYYY-MM. */
export const MONTH_PATTERN = /^\d{4}-(0[1-9]|1[0-2])$/;

/** Throws a ToolInputError unless `value` is missing or a YYYY-MM month. */
export function checkMonth(name: string, value: string | undefined): void {
  if (value !== undefined && !MONTH_PATTERN.test(value)) {
    throw new ToolInputError(`${name} must be a month in YYYY-MM format, for example 2018-03.`);
  }
}

/** Validates an optional month range: both ends are YYYY-MM and from_month is not after to_month. */
export function checkMonthRange(from: string | undefined, to: string | undefined): void {
  checkMonth("from_month", from);
  checkMonth("to_month", to);
  if (from !== undefined && to !== undefined && from > to) {
    throw new ToolInputError(`from_month (${from}) is after to_month (${to}).`);
  }
}

/**
 * Resolves an optional month range against the months the data covers. `warning` is set when the
 * range does not overlap the data at all.
 */
export function monthWindow(
  months: string[],
  from: string | undefined,
  to: string | undefined,
  what: { noun: string; monthKind: string },
): { from: string; to: string; warning: string | null } {
  const first = months[0] ?? "";
  const last = months[months.length - 1] ?? "";
  const lo = from ?? first;
  const hi = to ?? last;
  const outside = lo > last || hi < first;
  return {
    from: lo,
    to: hi,
    warning: outside
      ? `No ${what.noun} in the requested months: the data covers ${what.monthKind} months ${first} to ${last}.`
      : null,
  };
}

/** Lower case, trimmed, with spaces and hyphens turned into underscores. */
export function normalizeKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
}

export function round(value: number, decimals: number): number {
  const f = 10 ** decimals;
  return Math.round(value * f) / f;
}
