import { describe, expect, it } from "vitest";
import data from "../../data/olist_rfm.json";
import {
  queryRfm,
  quintileBin,
  type RfmCustomer,
  type RfmData,
  SEGMENTS,
  scoreCustomers,
} from "../../src/core/rfm";
import { ToolInputError } from "../../src/server/tool";
import parity from "../fixtures/rfm_parity.json";

const olist = data as RfmData;

const fixtureCustomers: RfmCustomer[] = parity.customers.map((c) => ({
  customer_id: c.customer_id,
  last_order_date: c.last_order_date,
  orders: c.orders,
  revenue: c.revenue,
}));

describe("scoreCustomers parity with the Python scores", () => {
  const scored = scoreCustomers(fixtureCustomers, parity.as_of);

  it("scores all 40 customers", () => {
    expect(scored).toHaveLength(40);
  });

  for (const expected of parity.customers) {
    it(`matches Python for ${expected.customer_id}`, () => {
      const got = scored.find((c) => c.customer_id === expected.customer_id);
      expect(got).toBeDefined();
      expect(got?.r_score).toBe(expected.r_score);
      expect(got?.f_score).toBe(expected.f_score);
      expect(got?.m_score).toBe(expected.m_score);
      expect(got?.segment).toBe(expected.segment);
    });
  }

  it("derives recency in whole days from the dates", () => {
    const first = parity.customers[0];
    const got = scored[0];
    const days = Math.round(
      (Date.parse(parity.as_of) - Date.parse(first?.last_order_date ?? "")) / 86_400_000,
    );
    expect(got?.recency_days).toBe(days);
  });
});

describe("quintileBin", () => {
  it("splits 10 ranks into five pairs", () => {
    const bins = Array.from({ length: 10 }, (_, i) => quintileBin(i + 1, 10));
    expect(bins).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  it("puts a single customer in the first bin and never leaves 0..4", () => {
    expect(quintileBin(1, 1)).toBe(0);
    for (const n of [2, 3, 4, 5, 6, 7, 99, 2000]) {
      for (const r of [1, Math.ceil(n / 2), n]) {
        const b = quintileBin(r, n);
        expect(b).toBeGreaterThanOrEqual(0);
        expect(b).toBeLessThanOrEqual(4);
      }
      expect(quintileBin(1, n)).toBe(0);
      expect(quintileBin(n, n)).toBe(n === 1 ? 0 : 4);
    }
  });
});

describe("queryRfm custom mode", () => {
  it("segments the parity customers with the same counts as Python", () => {
    const out = queryRfm(olist, { customers: fixtureCustomers, as_of: parity.as_of });
    expect(out.mode).toBe("custom");
    expect(out.source).toBe("user input");
    const expectedCounts = new Map<string, number>();
    for (const c of parity.customers) {
      expectedCounts.set(c.segment, (expectedCounts.get(c.segment) ?? 0) + 1);
    }
    for (const s of out.segments) {
      expect(s.customers).toBe(expectedCounts.get(s.segment));
    }
    expect(out.segments.reduce((sum, s) => sum + s.customers, 0)).toBe(40);
    expect(out.segments.reduce((sum, s) => sum + s.share, 0)).toBeCloseTo(1, 9);
  });

  it("defaults as_of to the latest order date plus one day", () => {
    const customers: RfmCustomer[] = [
      { customer_id: "a", last_order_date: "2024-03-10", orders: 1, revenue: 10 },
      { customer_id: "b", last_order_date: "2024-03-01", orders: 2, revenue: 20 },
      { customer_id: "c", last_order_date: "2024-02-27", orders: 1, revenue: 30 },
      { customer_id: "d", last_order_date: "2024-01-31", orders: 4, revenue: 40 },
      { customer_id: "e", last_order_date: "2023-12-31", orders: 1, revenue: 50 },
    ];
    const out = queryRfm(olist, { customers });
    expect(out.as_of).toBe("2024-03-11");
    const scored = scoreCustomers(customers, "2024-03-11");
    expect(scored.map((c) => c.recency_days)).toEqual([1, 10, 13, 40, 71]);
    expect(scored.map((c) => c.r_score)).toEqual([5, 4, 3, 2, 1]);
    expect(scored.map((c) => c.m_score)).toEqual([1, 2, 3, 4, 5]);
  });

  it("ranks ties in input order", () => {
    const customers: RfmCustomer[] = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"].map(
      (id) => ({ customer_id: id, last_order_date: "2024-01-01", orders: 1, revenue: 10 }),
    );
    const scored = scoreCustomers(customers, "2024-01-02");
    // Recency: the earlier customer gets the higher R. Money: the earlier gets the lower M.
    expect(scored.map((c) => c.r_score)).toEqual([5, 5, 4, 4, 3, 3, 2, 2, 1, 1]);
    expect(scored.map((c) => c.m_score)).toEqual([1, 1, 2, 2, 3, 3, 4, 4, 5, 5]);
  });

  it("warns that quintiles are not meaningful with fewer than 5 customers", () => {
    const out = queryRfm(olist, {
      customers: [
        { customer_id: "a", last_order_date: "2024-03-10", orders: 1, revenue: 10 },
        { customer_id: "b", last_order_date: "2024-03-01", orders: 2, revenue: 20 },
      ],
    });
    expect(out.warnings.join(" ")).toMatch(/quintiles/i);
    expect(out.warnings.join(" ")).toMatch(/fewer than 5/);
  });

  it("does not warn about quintiles with 5 or more customers", () => {
    const out = queryRfm(olist, { customers: fixtureCustomers, as_of: parity.as_of });
    expect(out.warnings.join(" ")).not.toMatch(/fewer than 5/);
  });

  it("filters to one segment and keeps shares relative to everyone", () => {
    const out = queryRfm(olist, {
      customers: fixtureCustomers,
      as_of: parity.as_of,
      segment: "champions",
    });
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]?.segment).toBe("champions");
    expect(out.segments[0]?.customers).toBe(13);
    expect(out.segments[0]?.share).toBeCloseTo(13 / 40, 9);
  });

  it("rejects 2,001 customers", () => {
    const customers = Array.from({ length: 2001 }, (_, i) => ({
      customer_id: `c${i}`,
      last_order_date: "2024-01-01",
      orders: 1,
      revenue: 1,
    }));
    expect(() => queryRfm(olist, { customers })).toThrow(ToolInputError);
  });

  it("accepts exactly 2,000 customers", () => {
    const customers = Array.from({ length: 2000 }, (_, i) => ({
      customer_id: `c${i}`,
      last_order_date: "2024-01-01",
      orders: 1 + (i % 4),
      revenue: 1 + (i % 97),
    }));
    const out = queryRfm(olist, { customers });
    expect(out.segments.reduce((sum, s) => sum + s.customers, 0)).toBe(2000);
  });

  it("rejects an empty list, bad dates, dates after as_of and repeated ids", () => {
    const base = { customer_id: "a", last_order_date: "2024-03-10", orders: 1, revenue: 10 };
    expect(() => queryRfm(olist, { customers: [] })).toThrow(ToolInputError);
    expect(() =>
      queryRfm(olist, { customers: [{ ...base, last_order_date: "2024-02-30" }] }),
    ).toThrow(/valid date/);
    expect(() =>
      queryRfm(olist, { customers: [{ ...base, last_order_date: "10/03/2024" }] }),
    ).toThrow(ToolInputError);
    expect(() => queryRfm(olist, { customers: [base], as_of: "2024-03-01" })).toThrow(
      /after as_of/,
    );
    expect(() => queryRfm(olist, { customers: [base, base] })).toThrow(/more than once/);
    expect(() => queryRfm(olist, { customers: [{ ...base, orders: 0 }] })).toThrow(ToolInputError);
    expect(() => queryRfm(olist, { customers: [{ ...base, revenue: -1 }] })).toThrow(
      ToolInputError,
    );
  });

  it("rejects state with customers, and as_of without customers", () => {
    const customers = [{ customer_id: "a", last_order_date: "2024-03-10", orders: 1, revenue: 10 }];
    expect(() => queryRfm(olist, { customers, state: "SP" })).toThrow(ToolInputError);
    expect(() => queryRfm(olist, { as_of: "2024-03-10" })).toThrow(ToolInputError);
  });
});

describe("queryRfm Olist mode", () => {
  it("covers all customers and the shares sum to 1", () => {
    const out = queryRfm(olist, {});
    expect(out.mode).toBe("olist");
    expect(out.as_of).toBe("2018-09-01");
    expect(out.total_customers).toBe(olist.summary.reduce((s, r) => s + r.customers, 0));
    expect(out.segments.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 9);
    expect(out.segments.map((s) => s.segment)).toEqual(
      SEGMENTS.filter((name) => out.segments.some((s) => s.segment === name)),
    );
    expect(out.rules).toEqual(olist.rules);
    expect(out.source).toBe(
      "Olist, Brazilian E-Commerce Public Dataset, Kaggle (CC BY-NC-SA 4.0), aggregated",
    );
  });

  it("filters by state ignoring case, with shares inside the state", () => {
    const out = queryRfm(olist, { state: "sp" });
    const rows = olist.summary.filter((r) => r.state === "SP");
    expect(out.total_customers).toBe(rows.reduce((s, r) => s + r.customers, 0));
    expect(out.segments.reduce((s, r) => s + r.share, 0)).toBeCloseTo(1, 9);
    const champions = out.segments.find((s) => s.segment === "champions");
    expect(champions?.customers).toBe(rows.find((r) => r.segment === "champions")?.customers);
  });

  it("averages are weighted by customers across states", () => {
    const out = queryRfm(olist, { segment: "recent" });
    const rows = olist.summary.filter((r) => r.segment === "recent");
    const n = rows.reduce((s, r) => s + r.customers, 0);
    const revenue = rows.reduce((s, r) => s + r.revenue, 0);
    const recency = rows.reduce((s, r) => s + r.customers * r.avg_recency_days, 0) / n;
    expect(out.segments).toHaveLength(1);
    expect(out.segments[0]?.customers).toBe(n);
    expect(out.segments[0]?.revenue).toBeCloseTo(revenue, 1);
    expect(out.segments[0]?.avg_monetary).toBeCloseTo(revenue / n, 1);
    expect(out.segments[0]?.avg_recency_days).toBeCloseTo(recency, 1);
  });

  it("returns empty segments and lists the valid states for an unknown state", () => {
    const out = queryRfm(olist, { state: "XX" });
    expect(out.segments).toEqual([]);
    const text = out.warnings.join(" ");
    expect(text).toContain("XX");
    for (const s of new Set(olist.summary.map((r) => r.state))) expect(text).toContain(s);
  });
});

describe("dates and ties", () => {
  const one = (date: string, asOf: string) =>
    scoreCustomers([{ customer_id: "a", last_order_date: date, orders: 1, revenue: 1 }], asOf)[0]
      ?.recency_days;

  it("counts whole days across leap days and year ends", () => {
    expect(one("2024-02-28", "2024-03-01")).toBe(2);
    expect(one("2023-02-28", "2023-03-01")).toBe(1);
    expect(one("2023-12-31", "2024-01-01")).toBe(1);
    expect(one("1970-01-01", "1970-01-31")).toBe(30);
    expect(one("2000-02-29", "2000-03-01")).toBe(1);
  });

  it("agrees with Date arithmetic over many dates", () => {
    const asOf = "2030-06-15";
    for (let t = Date.UTC(1999, 0, 1); t < Date.UTC(2030, 5, 15); t += 37 * 86_400_000) {
      const date = new Date(t).toISOString().slice(0, 10);
      expect(one(date, asOf)).toBe(Math.round((Date.UTC(2030, 5, 15) - t) / 86_400_000));
    }
  });

  it("rejects dates that do not exist", () => {
    for (const bad of [
      "2023-02-29",
      "2100-02-29",
      "2024-04-31",
      "2024-00-10",
      "2024-13-01",
      "2024-1-01",
      "abcd-ef-gh",
    ]) {
      expect(() => one(bad, "2025-01-01")).toThrow(/valid date/);
    }
    expect(one("2000-02-29", "2000-02-29")).toBe(0);
  });

  const base = { orders: 1 };
  it("does not warn about ties that stay inside one score group", () => {
    const customers = Array.from({ length: 10 }, (_, i) => ({
      ...base,
      customer_id: `c${i}`,
      last_order_date: `2024-01-${String(i + 1).padStart(2, "0")}`,
      revenue: i === 1 ? 10 : 10 + i * 10, // ranks 1 and 2 tie at 10 (same fifth)
    }));
    const out = queryRfm(olist, { customers, as_of: "2024-02-01" });
    expect(out.warnings.join(" ")).not.toMatch(/straddle/);
  });

  it("warns when tied customers land in different score groups", () => {
    const customers = Array.from({ length: 10 }, (_, i) => ({
      ...base,
      customer_id: `c${i}`,
      last_order_date: "2024-01-01",
      revenue: 10 + i,
    }));
    const out = queryRfm(olist, { customers, as_of: "2024-02-01" });
    expect(out.warnings.join(" ")).toMatch(/straddle a score boundary/);
  });
});

describe("empty segment filter", () => {
  it("explains that no customer falls in the segment", () => {
    const out = queryRfm(olist, {
      customers: fixtureCustomers.filter((c) => c.orders === 1),
      as_of: parity.as_of,
      segment: "champions",
    });
    expect(out.segments).toEqual([]);
    expect(out.warnings.join(" ")).toMatch(/No customers fall in/);
  });
});
