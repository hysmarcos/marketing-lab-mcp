import { describe, expect, it } from "vitest";
import data from "../../data/mmm_results.json";
import {
  adstockedSpend,
  adstockWeights,
  CHANNELS,
  logistic,
  type MmmCore,
  type MmmResults,
  optimizeBudget,
  percentile,
  simulateBudget,
  simulatePlan,
} from "../../src/core/budget";
import { ToolInputError } from "../../src/server/tool";
import fixture from "../fixtures/simulator_cases.json";

const results = data as unknown as MmmResults;
const CURRENT_TOTAL = Object.values(results.plans.current).reduce((a, b) => a + b, 0);
const SLSQP_OPTIMUM = 4706140.84;

const close = (a: number, b: number) => Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b));

describe("simulatePlan parity with the Python model", () => {
  it("has the four reference cases", () => {
    expect(fixture.cases).toHaveLength(4);
  });

  for (const [i, c] of fixture.cases.entries()) {
    it(`matches media and total bands for case ${i}`, () => {
      const r = simulatePlan(fixture.results_subset as unknown as MmmCore, c.plan);
      for (const k of ["media", "total"] as const) {
        for (const q of ["median", "p05", "p95"] as const) {
          const got = r[k][q];
          const want = c.expected[k][q];
          expect(close(got, want), `${k}.${q}: ${got} vs ${want}`).toBe(true);
        }
      }
    });
  }
});

describe("primitives", () => {
  it("percentile matches numpy", () => {
    expect(percentile([1, 2, 3, 4], 5)).toBeCloseTo(1.15, 12);
    expect(percentile([4, 1, 3, 2], 50)).toBe(2.5);
  });

  it("logistic saturation is 0 at 0 and known at 1", () => {
    expect(logistic(0)).toBe(0);
    expect(logistic(1)).toBeCloseTo(0.46211715726000974, 12);
  });

  it("adstock weights are geometric and sum to 1", () => {
    const w = adstockWeights(0.5, 3);
    [1, 0.5, 0.25].forEach((v, i) => {
      expect(w[i]).toBeCloseTo(v / 1.75, 15);
    });
  });
});

describe("adstockedSpend", () => {
  it("mixes real history with the constant future spend", () => {
    const x = adstockedSpend(0.5, [10], 4, 2);
    expect(x[0]).toBeCloseTo(6, 12);
    expect(x[1]).toBeCloseTo(4, 12);
  });
});

describe("simulateBudget", () => {
  it("defaults to the current plan and shows no difference", () => {
    const out = simulateBudget(results, {});
    expect(out.horizon_weeks).toBe(13);
    expect(out.vs_current.media_sales_diff_median).toBeCloseTo(0, 6);
    expect(out.vs_current.pct).toBeCloseTo(0, 6);
    expect(out.out_of_range).toEqual([]);
    expect(Object.keys(out.weekly_spend)).toEqual(["tv", "ooh", "print", "facebook", "search"]);
    expect(out.media_sales.p05).toBeLessThanOrEqual(out.media_sales.median);
    expect(out.media_sales.median).toBeLessThanOrEqual(out.media_sales.p95);
    expect(out.source).toContain("Robyn");
  });

  it("accepts short and long channel names and fills the rest with the current plan", () => {
    const a = simulateBudget(results, { weekly_spend: { tv: 20000 } });
    const b = simulateBudget(results, { weekly_spend: { tv_S: 20000 } });
    expect(a.media_sales).toEqual(b.media_sales);
    expect(a.weekly_spend.tv).toBe(20000);
    expect(a.weekly_spend.search).toBeCloseTo(results.plans.current.search_S, 9);
    expect(a.vs_current.media_sales_diff_median).toBeGreaterThan(0);
  });

  it("is sensitive to the plan: the optimal plan of the source model beats the current one", () => {
    const out = simulateBudget(results, {
      weekly_spend: Object.fromEntries(CHANNELS.map((c) => [c, results.plans.optimal[c]])),
    });
    expect(out.vs_current.media_sales_diff_median).toBeGreaterThan(0);
  });

  it("rejects an unknown channel and lists the valid ones", () => {
    expect(() => simulateBudget(results, { weekly_spend: { radio: 100 } })).toThrow(ToolInputError);
    try {
      simulateBudget(results, { weekly_spend: { radio: 100 } });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("radio");
      for (const c of ["tv", "ooh", "print", "facebook", "search"]) expect(msg).toContain(c);
    }
  });

  it("rejects negative spend and lists the valid channels", () => {
    expect(() => simulateBudget(results, { weekly_spend: { tv: -5 } })).toThrow(ToolInputError);
    try {
      simulateBudget(results, { weekly_spend: { tv: -5 } });
    } catch (e) {
      const msg = (e as Error).message;
      expect(msg).toContain("tv");
      expect(msg).toContain("search");
    }
  });

  it("rejects the same channel given twice", () => {
    expect(() => simulateBudget(results, { weekly_spend: { tv: 1, tv_S: 2 } })).toThrow(
      ToolInputError,
    );
  });

  it("flags spend above the observed maximum as out of range with a warning", () => {
    const over = results.spend_max_weekly.tv_S * 1.1;
    const out = simulateBudget(results, { weekly_spend: { tv: over } });
    expect(out.out_of_range).toEqual(["tv"]);
    expect(out.warnings.some((w) => w.includes("tv"))).toBe(true);
    const inside = simulateBudget(results, { weekly_spend: { tv: results.spend_max_weekly.tv_S } });
    expect(inside.out_of_range).toEqual([]);
  });
});

describe("optimizeBudget", () => {
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

  it("at the current total allocates it fully and beats the current plan", () => {
    const out = optimizeBudget(results, {});
    expect(Math.abs(sum(out.allocation) - CURRENT_TOTAL)).toBeLessThan(1);
    expect(out.vs_current.media_sales_diff_median).toBeGreaterThanOrEqual(0);
    expect(out.media_sales.median).toBeGreaterThanOrEqual(
      simulateBudget(results, {}).media_sales.median,
    );
    expect(out.media_sales.median).toBeGreaterThanOrEqual(0.97 * SLSQP_OPTIMUM);
  });

  it("respects min and max bounds", () => {
    const out = optimizeBudget(results, {
      min: { search: 10000, ooh: 3000 },
      max: { print: 4000, facebook_S: 5000 },
    });
    expect(out.allocation.search).toBeGreaterThanOrEqual(10000 - 0.01);
    expect(out.allocation.ooh).toBeGreaterThanOrEqual(3000 - 0.01);
    expect(out.allocation.print).toBeLessThanOrEqual(4000 + 0.01);
    expect(out.allocation.facebook).toBeLessThanOrEqual(5000 + 0.01);
    expect(Math.abs(sum(out.allocation) - CURRENT_TOTAL)).toBeLessThan(1);
  });

  it("scales to another total", () => {
    const out = optimizeBudget(results, { total_weekly: 20000 });
    expect(Math.abs(sum(out.allocation) - 20000)).toBeLessThan(1);
    expect(out.vs_current.media_sales_diff_median).toBeLessThan(0);
  });

  it("rejects unknown channels in min and max", () => {
    expect(() => optimizeBudget(results, { min: { radio: 1 } })).toThrow(ToolInputError);
    expect(() => optimizeBudget(results, { max: { radio: 1 } })).toThrow(/tv/);
  });

  it("rejects impossible requests", () => {
    expect(() => optimizeBudget(results, { total_weekly: 0 })).toThrow(ToolInputError);
    expect(() => optimizeBudget(results, { total_weekly: CURRENT_TOTAL * 5.01 })).toThrow(
      ToolInputError,
    );
    expect(() => optimizeBudget(results, { min: { tv: 50000 }, total_weekly: 10000 })).toThrow(
      ToolInputError,
    );
    expect(() => optimizeBudget(results, { min: { tv: 5000 }, max: { tv: 1000 } })).toThrow(
      ToolInputError,
    );
    expect(() =>
      optimizeBudget(results, {
        total_weekly: 40000,
        max: { tv: 1000, ooh: 1000, print: 1000, facebook: 1000, search: 1000 },
      }),
    ).toThrow(ToolInputError);
  });
});
