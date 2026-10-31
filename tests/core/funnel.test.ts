import { describe, expect, it } from "vitest";
import data from "../../data/olist_funnel.json";
import { type FunnelData, queryFunnel } from "../../src/core/funnel";
import { ToolInputError } from "../../src/server/tool";

const funnel = data as FunnelData;

/** A tiny funnel with known numbers, to check medians and null handling by hand. */
const tiny: FunnelData = {
  source: "test source",
  license: "test license",
  mql: {
    months: ["2018-01", "2018-02"],
    origins: ["email", "social"],
    counts: [
      [10, 5],
      [20, 0],
    ],
  },
  deals: {
    origin: ["email", "email", "email", "email", "social", "social", "social"],
    contact_month: ["2018-01", "2018-01", "2018-02", "2018-02", "2018-01", "2018-01", "2018-01"],
    segment: ["a", "a", "b", "b", "a", "b", "b"],
    days_to_close: [1, 2, 3, 10, 5, 9, 1],
  },
};

describe("queryFunnel defaults", () => {
  const out = queryFunnel(funnel, {});

  it("groups by origin and totals 8,000 MQLs and 842 deals", () => {
    expect(out.group_by).toBe("origin");
    expect(out.totals.mqls).toBe(8000);
    expect(out.totals.deals).toBe(842);
    expect(out.totals.conversion_rate).toBe(842 / 8000);
    expect(out.rows.reduce((s, r) => s + (r.mqls ?? 0), 0)).toBe(8000);
    expect(out.rows.reduce((s, r) => s + r.deals, 0)).toBe(842);
  });

  it("returns the 10 origins sorted by deals, descending", () => {
    expect(out.rows).toHaveLength(10);
    expect(out.rows[0]?.key).toBe("organic_search");
    const deals = out.rows.map((r) => r.deals);
    expect(deals).toEqual([...deals].sort((a, b) => b - a));
  });

  it("computes each row's conversion rate from its own MQLs and deals", () => {
    const paid = out.rows.find((r) => r.key === "paid_search");
    expect(paid?.mqls).toBe(1586);
    expect(paid?.deals).toBe(195);
    expect(paid?.conversion_rate).toBe(195 / 1586);
  });

  it("uses the source string of the file", () => {
    expect(out.source).toBe(funnel.source);
    expect(out.source).toContain("Marketing Funnel");
  });

  it("keeps the deal that closed before its first contact and says so", () => {
    expect(Math.min(...funnel.deals.days_to_close)).toBe(-2);
    expect(out.warnings.join(" ")).toMatch(/negative/i);
  });
});

describe("medians", () => {
  it("averages the two middle values for an even count and takes the middle for an odd one", () => {
    const out = queryFunnel(tiny, {});
    const email = out.rows.find((r) => r.key === "email");
    const social = out.rows.find((r) => r.key === "social");
    expect(email?.median_days_to_close).toBe(2.5); // 1, 2, 3, 10
    expect(social?.median_days_to_close).toBe(5); // 1, 5, 9
  });

  it("is null when a row has no deals, and conversion_rate is null when it has no MQLs", () => {
    const feb = queryFunnel(tiny, { from_month: "2018-02", to_month: "2018-02" });
    const social = feb.rows.find((r) => r.key === "social");
    expect(social).toBeUndefined(); // no MQLs and no deals in February
    const emailOnly = queryFunnel(tiny, { group_by: "month" });
    const jan = emailOnly.rows.find((r) => r.key === "2018-01");
    expect(jan?.mqls).toBe(15);
    expect(jan?.deals).toBe(5);
    const sparse = queryFunnel(funnel, { from_month: "2017-06", to_month: "2017-06" });
    const display = sparse.rows.find((r) => r.key === "display");
    expect(display?.mqls).toBe(1);
    expect(display?.deals).toBe(0);
    expect(display?.median_days_to_close).toBeNull();
    expect(display?.conversion_rate).toBe(0);
  });

  it("handles negative days in the median", () => {
    const withNegative: FunnelData = {
      ...tiny,
      deals: { ...tiny.deals, days_to_close: [-2, 2, 3, 10, 5, 9, 1] },
    };
    const email = queryFunnel(withNegative, {}).rows.find((r) => r.key === "email");
    expect(email?.median_days_to_close).toBe(2.5); // -2, 2, 3, 10
    expect(queryFunnel(withNegative, {}).warnings.join(" ")).toMatch(/negative/i);
  });
});

describe("other groupings and filters", () => {
  it("groups by business_segment with null MQLs and conversion", () => {
    const out = queryFunnel(funnel, { group_by: "business_segment" });
    expect(out.rows.length).toBeGreaterThan(10);
    for (const r of out.rows) {
      expect(r.mqls).toBeNull();
      expect(r.conversion_rate).toBeNull();
      expect(r.deals).toBeGreaterThan(0);
    }
    expect(out.rows.reduce((s, r) => s + r.deals, 0)).toBe(842);
    const deals = out.rows.map((r) => r.deals);
    expect(deals).toEqual([...deals].sort((a, b) => b - a));
    expect(out.totals.mqls).toBe(8000);
    expect(out.warnings.join(" ")).toMatch(/business segment/i);
  });

  it("groups by month in date order and the months add up", () => {
    const out = queryFunnel(funnel, { group_by: "month" });
    expect(out.rows.map((r) => r.key)).toEqual(funnel.mql.months);
    expect(out.rows.reduce((s, r) => s + (r.mqls ?? 0), 0)).toBe(8000);
    expect(out.rows.reduce((s, r) => s + r.deals, 0)).toBe(842);
    expect(out.warnings.join(" ")).toMatch(/less time/i);
  });

  it("filters by origin ignoring case and spaces", () => {
    const exact = queryFunnel(funnel, { origin: "paid_search", group_by: "month" });
    const loose = queryFunnel(funnel, { origin: " Paid Search ", group_by: "month" });
    expect(loose.rows).toEqual(exact.rows);
    expect(exact.totals.mqls).toBe(1586);
    expect(exact.totals.deals).toBe(195);
  });

  it("applies month filters to the contact month", () => {
    const out = queryFunnel(funnel, { from_month: "2018-01", to_month: "2018-03" });
    const idx = funnel.mql.months
      .map((m, i) => [m, i] as const)
      .filter(([m]) => m >= "2018-01" && m <= "2018-03");
    const expectedMqls = idx.reduce(
      (s, [, i]) => s + (funnel.mql.counts[i] ?? []).reduce((a, b) => a + b, 0),
      0,
    );
    const expectedDeals = funnel.deals.contact_month.filter(
      (m) => m >= "2018-01" && m <= "2018-03",
    ).length;
    expect(out.totals.mqls).toBe(expectedMqls);
    expect(out.totals.deals).toBe(expectedDeals);
  });

  it("returns no rows and lists the 10 origins for an unknown origin", () => {
    const out = queryFunnel(funnel, { origin: "tiktok" });
    expect(out.rows).toEqual([]);
    expect(out.totals).toEqual({ mqls: 0, deals: 0, conversion_rate: null });
    const text = out.warnings.join(" ");
    expect(text).toContain("tiktok");
    expect(funnel.mql.origins).toHaveLength(10);
    for (const o of funnel.mql.origins) expect(text).toContain(o);
  });

  it("warns when the month range is outside the data", () => {
    const out = queryFunnel(funnel, { from_month: "2019-01" });
    expect(out.rows).toEqual([]);
    expect(out.warnings.join(" ")).toContain("2017-06");
    expect(out.warnings.join(" ")).toContain("2018-05");
  });

  it("warns about rows with few MQLs", () => {
    expect(queryFunnel(funnel, {}).warnings.join(" ")).not.toMatch(/fewer than 30 MQLs/);
    const out = queryFunnel(funnel, { from_month: "2017-06", to_month: "2017-06" });
    expect(out.warnings.join(" ")).toMatch(/fewer than 30 MQLs/);
  });

  it("rejects from_month after to_month and malformed months", () => {
    expect(() => queryFunnel(funnel, { from_month: "2018-05", to_month: "2018-01" })).toThrow(
      ToolInputError,
    );
    expect(() => queryFunnel(funnel, { from_month: "2018-5" })).toThrow(ToolInputError);
    expect(() => queryFunnel(funnel, { to_month: "2018-13" })).toThrow(ToolInputError);
  });
});
