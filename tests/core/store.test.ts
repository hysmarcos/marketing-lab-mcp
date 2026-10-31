import { describe, expect, it } from "vitest";
import data from "../../data/olist_sales.json";
import { queryStoreSales, type SalesData } from "../../src/core/store";
import { ToolInputError } from "../../src/server/tool";

const sales = data as SalesData;
const cubeRevenue = sales.rows.revenue.reduce((s, v) => s + v, 0);
const cubeOrders = sales.rows.orders.reduce((s, v) => s + v, 0);

describe("queryStoreSales", () => {
  it("adds up to the whole cube when grouping by category without filters", () => {
    const out = queryStoreSales(sales, { group_by: "category", top: 50 });
    expect(out.total.revenue).toBeCloseTo(cubeRevenue, 1);
    expect(out.total.orders).toBe(cubeOrders);
    expect(out.rows).toHaveLength(50);
    expect(out.source).toBe(
      "Olist, Brazilian E-Commerce Public Dataset, Kaggle (CC BY-NC-SA 4.0), aggregated",
    );
  });

  it("defaults to revenue, top 10, sorted descending", () => {
    const out = queryStoreSales(sales, { group_by: "category" });
    expect(out.metric).toBe("revenue");
    expect(out.rows).toHaveLength(10);
    const values = out.rows.map((r) => r.value as number);
    expect(values).toEqual([...values].sort((a, b) => b - a));
    expect(out.rows[0]?.value).toBe(out.rows[0]?.revenue);
  });

  it("reports the number of groups before the top cut", () => {
    const out = queryStoreSales(sales, { group_by: "category", top: 5 });
    expect(out.rows).toHaveLength(5);
    expect(out.groups).toBe(sales.categories.length);
  });

  it("computes avg_review as review_sum / review_n over the matching rows", () => {
    const idx = sales.categories.indexOf("health_beauty");
    let sum = 0;
    let n = 0;
    sales.rows.c.forEach((c, i) => {
      if (c === idx) {
        sum += sales.rows.review_sum[i] ?? 0;
        n += sales.rows.review_n[i] ?? 0;
      }
    });
    const out = queryStoreSales(sales, {
      group_by: "category",
      metric: "avg_review",
      category: "health_beauty",
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]?.value).toBeCloseTo(sum / n, 3);
  });

  it("computes late_delivery_rate as late_n / orders", () => {
    const idx = sales.states.indexOf("SP");
    let late = 0;
    let orders = 0;
    sales.rows.s.forEach((s, i) => {
      if (s === idx) {
        late += sales.rows.late_n[i] ?? 0;
        orders += sales.rows.orders[i] ?? 0;
      }
    });
    const out = queryStoreSales(sales, {
      group_by: "state",
      metric: "late_delivery_rate",
      state: "sp",
    });
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]?.key).toBe("SP");
    expect(out.rows[0]?.value).toBeCloseTo(late / orders, 4);
  });

  it("sorts months ascending and ignores top", () => {
    const out = queryStoreSales(sales, { group_by: "month", top: 3 });
    expect(out.rows).toHaveLength(sales.months.length);
    expect(out.rows.map((r) => r.key)).toEqual(sales.months);
  });

  it("filters by month range", () => {
    const out = queryStoreSales(sales, {
      group_by: "month",
      from_month: "2017-11",
      to_month: "2018-01",
    });
    expect(out.rows.map((r) => r.key)).toEqual(["2017-11", "2017-12", "2018-01"]);
  });

  it("matches categories ignoring case, spaces and hyphens", () => {
    const exact = queryStoreSales(sales, { group_by: "state", category: "health_beauty" });
    const loose = queryStoreSales(sales, { group_by: "state", category: " Health Beauty " });
    expect(loose.rows).toEqual(exact.rows);
    expect(exact.rows.length).toBeGreaterThan(0);
    const dashed = queryStoreSales(sales, { group_by: "state", category: "health-beauty" });
    expect(dashed.rows).toEqual(exact.rows);
  });

  it("returns no rows and lists the valid states for an unknown state", () => {
    const out = queryStoreSales(sales, { group_by: "category", state: "XX" });
    expect(out.rows).toEqual([]);
    expect(out.total).toEqual({ orders: 0, revenue: 0 });
    expect(out.warnings.join(" ")).toContain("XX");
    for (const s of sales.states) expect(out.warnings.join(" ")).toContain(s);
  });

  it("returns no rows and lists the categories for an unknown category", () => {
    const out = queryStoreSales(sales, { group_by: "state", category: "beleza" });
    expect(out.rows).toEqual([]);
    expect(out.warnings.join(" ")).toContain("health_beauty");
  });

  it("warns when the month range is outside the data", () => {
    const out = queryStoreSales(sales, { group_by: "month", from_month: "2019-01" });
    expect(out.rows).toEqual([]);
    expect(out.warnings.join(" ")).toContain("2017-01");
    expect(out.warnings.join(" ")).toContain("2018-08");
  });

  it("rejects from_month after to_month", () => {
    expect(() =>
      queryStoreSales(sales, { group_by: "month", from_month: "2018-05", to_month: "2018-01" }),
    ).toThrow(ToolInputError);
  });

  it("rejects malformed months and out-of-range top", () => {
    expect(() => queryStoreSales(sales, { group_by: "month", from_month: "2018-13" })).toThrow(
      ToolInputError,
    );
    expect(() => queryStoreSales(sales, { group_by: "month", to_month: "May 2018" })).toThrow(
      ToolInputError,
    );
    expect(() => queryStoreSales(sales, { group_by: "category", top: 0 })).toThrow(ToolInputError);
    expect(() => queryStoreSales(sales, { group_by: "category", top: 51 })).toThrow(ToolInputError);
  });

  it("warns that orders are counted once per category when no category is chosen", () => {
    const all = queryStoreSales(sales, { group_by: "state" });
    expect(all.warnings.join(" ")).toMatch(/once per category/);
    const one = queryStoreSales(sales, { group_by: "state", category: "toys" });
    expect(one.warnings.join(" ")).not.toMatch(/once per category/);
  });

  it("explains a valid combination of filters that matches nothing", () => {
    let pair: [string, string] | null = null;
    outer: for (const [ci, category] of sales.categories.entries()) {
      for (const [si, state] of sales.states.entries()) {
        const hit = sales.rows.c.some((c, i) => c === ci && sales.rows.s[i] === si);
        if (!hit) {
          pair = [category, state];
          break outer;
        }
      }
    }
    expect(pair).not.toBeNull();
    const [category, state] = pair as [string, string];
    const out = queryStoreSales(sales, { group_by: "month", category, state });
    expect(out.rows).toEqual([]);
    expect(out.groups).toBe(0);
    expect(out.warnings.join(" ")).toMatch(/No orders match these filters/);
    expect(out.warnings.join(" ")).toContain(category);
    expect(out.warnings.join(" ")).toContain(state);
  });
});
