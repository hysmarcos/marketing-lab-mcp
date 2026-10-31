import { checkMonthRange, monthWindow, normalizeKey } from "./query";

/** data/olist_funnel.json: leads (MQLs) per contact month and origin, and one entry per closed deal. */
export type FunnelData = {
  source: string;
  license: string;
  mql: {
    months: string[];
    origins: string[];
    /** counts[month][origin], indexes into `months` and `origins`. */
    counts: number[][];
  };
  /** Parallel arrays, one entry per closed deal. */
  deals: {
    origin: string[];
    contact_month: string[];
    segment: string[];
    days_to_close: number[];
  };
};

export type FunnelGroupBy = "origin" | "business_segment" | "month";

export type FunnelRow = {
  key: string;
  /** Null for business_segment: leads have no segment until they close. */
  mqls: number | null;
  deals: number;
  /** deals / mqls; null when mqls is null or 0. */
  conversion_rate: number | null;
  /** Median days from first contact to won date; null when there are no deals. */
  median_days_to_close: number | null;
};

export type FunnelResult = {
  group_by: FunnelGroupBy;
  rows: FunnelRow[];
  totals: { mqls: number; deals: number; conversion_rate: number | null };
  warnings: string[];
  source: string;
};

const THIN_MQLS = 30;

/** True median: the middle value, or the average of the two middle values for an even count. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1
    ? (sorted[mid] as number)
    : ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2;
}

function rate(deals: number, mqls: number | null): number | null {
  return mqls === null || mqls === 0 ? null : deals / mqls;
}

export function queryFunnel(
  data: FunnelData,
  args: {
    group_by?: FunnelGroupBy;
    origin?: string;
    from_month?: string;
    to_month?: string;
  },
): FunnelResult {
  const groupBy = args.group_by ?? "origin";
  checkMonthRange(args.from_month, args.to_month);

  const warnings: string[] = [];
  const empty = (): FunnelResult => ({
    group_by: groupBy,
    rows: [],
    totals: { mqls: 0, deals: 0, conversion_rate: null },
    warnings,
    source: data.source,
  });

  let origin: string | undefined;
  if (args.origin !== undefined) {
    origin = normalizeKey(args.origin);
    if (!data.mql.origins.includes(origin)) {
      warnings.push(
        `Unknown origin '${args.origin}'. Valid origins: ${data.mql.origins.join(", ")}.`,
      );
      return empty();
    }
  }

  const { months, origins, counts } = data.mql;
  const window = monthWindow(months, args.from_month, args.to_month, {
    noun: "leads",
    monthKind: "contact",
  });
  if (window.warning) {
    warnings.push(window.warning);
    return empty();
  }
  const { from, to } = window;

  // MQLs by month and by origin, for the months and origin in scope.
  const mqlsByMonth = new Map<string, number>();
  const mqlsByOrigin = new Map<string, number>();
  let totalMqls = 0;
  months.forEach((month, mi) => {
    if (month < from || month > to) return;
    origins.forEach((name, oi) => {
      if (origin !== undefined && name !== origin) return;
      const n = counts[mi]?.[oi] ?? 0;
      mqlsByMonth.set(month, (mqlsByMonth.get(month) ?? 0) + n);
      mqlsByOrigin.set(name, (mqlsByOrigin.get(name) ?? 0) + n);
      totalMqls += n;
    });
  });

  // Days to close by group, for the deals in scope (month filter = contact month).
  const d = data.deals;
  const groupOf = (i: number): string =>
    groupBy === "origin"
      ? (d.origin[i] as string)
      : groupBy === "month"
        ? (d.contact_month[i] as string)
        : (d.segment[i] as string);
  const daysByGroup = new Map<string, number[]>();
  let totalDeals = 0;
  let negative = 0;
  for (let i = 0; i < d.origin.length; i++) {
    const month = d.contact_month[i] as string;
    if (month < from || month > to) continue;
    if (origin !== undefined && d.origin[i] !== origin) continue;
    const days = d.days_to_close[i] as number;
    const key = groupOf(i);
    const list = daysByGroup.get(key);
    if (list) list.push(days);
    else daysByGroup.set(key, [days]);
    totalDeals++;
    if (days < 0) negative++;
  }

  const keys =
    groupBy === "origin" ? origins : groupBy === "month" ? months : [...daysByGroup.keys()].sort();
  const rows: FunnelRow[] = [];
  for (const key of keys) {
    const days = daysByGroup.get(key) ?? [];
    const mqls =
      groupBy === "origin"
        ? (mqlsByOrigin.get(key) ?? 0)
        : groupBy === "month"
          ? (mqlsByMonth.get(key) ?? 0)
          : null;
    if (days.length === 0 && !mqls) continue;
    rows.push({
      key,
      mqls,
      deals: days.length,
      conversion_rate: rate(days.length, mqls),
      median_days_to_close: median(days),
    });
  }
  if (rows.length === 0) {
    warnings.push(
      `No leads match these filters (${origin !== undefined ? `origin ${origin}, ` : ""}contact months ${from} to ${to}). Each filter is valid on its own; try loosening one.`,
    );
    return empty();
  }
  if (groupBy === "month") {
    rows.sort((a, b) => (a.key < b.key ? -1 : 1));
  } else {
    rows.sort(
      (a, b) => b.deals - a.deals || (b.mqls ?? 0) - (a.mqls ?? 0) || (a.key < b.key ? -1 : 1),
    );
  }

  if (groupBy === "business_segment") {
    warnings.push(
      "A lead has no business segment until its deal closes, so MQL counts and conversion rates are not available by business segment (mqls and conversion_rate are null). Totals still use all leads in scope.",
    );
  }
  if (groupBy !== "business_segment") {
    const thin = rows.filter((r) => (r.mqls ?? 0) < THIN_MQLS).length;
    if (thin > 0) {
      warnings.push(
        `${thin} of ${rows.length} rows have fewer than ${THIN_MQLS} MQLs, so their conversion rate and median days to close are noisy.`,
      );
    }
  }
  if (groupBy === "month") {
    warnings.push(
      "Leads from the latest months have had less time to close before the data ends, so their conversion rates are understated.",
    );
  }
  if (negative > 0) {
    warnings.push(
      `${negative} deal(s) in scope have negative days_to_close (won before the recorded first contact date, a quirk of the source). They are kept, so medians can include a negative value.`,
    );
  }

  return {
    group_by: groupBy,
    rows,
    totals: { mqls: totalMqls, deals: totalDeals, conversion_rate: rate(totalDeals, totalMqls) },
    warnings,
    source: data.source,
  };
}
