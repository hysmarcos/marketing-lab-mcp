import { describe, expect, it } from "vitest";
import { evaluateAbTest, planAbTest } from "../../src/core/abtest";
import { ToolInputError } from "../../src/server/tool";
import reference from "../fixtures/abtest_reference.json";

describe("evaluateAbTest", () => {
  it("evaluates a clear win", () => {
    const r = evaluateAbTest({
      control: { visitors: 10000, conversions: 500 },
      variant: { visitors: 10000, conversions: 570 },
    });
    expect(r.p_value).toBeCloseTo(0.02783, 5);
    expect(r.ci_low).toBeCloseTo(0.00076, 5);
    expect(r.ci_high).toBeCloseTo(0.01324, 5);
    expect(r.prob_variant_better).toBeCloseTo(0.986, 3);
    expect(r.significant).toBe(true);
    expect(r.control_rate).toBeCloseTo(0.05, 12);
    expect(r.variant_rate).toBeCloseTo(0.057, 12);
    expect(r.relative_lift).toBeCloseTo(0.14, 9);
    expect(r.srm_detected).toBe(false);
    expect(r.source).toBe("user input");
  });

  it("stays finite with zero conversions and warns", () => {
    const zero = evaluateAbTest({
      control: { visitors: 1000, conversions: 0 },
      variant: { visitors: 1000, conversions: 3 },
    });
    expect(Object.values(zero).every((v) => typeof v !== "number" || Number.isFinite(v))).toBe(
      true,
    );
    expect(zero.relative_lift).toBeNull();
    expect(zero.warnings.length).toBeGreaterThan(0);
  });

  it("stays finite when both arms have no conversions", () => {
    const r = evaluateAbTest({
      control: { visitors: 500, conversions: 0 },
      variant: { visitors: 500, conversions: 0 },
    });
    expect(r.p_value).toBe(1);
    expect(r.significant).toBe(false);
    expect(Number.isFinite(r.ci_low) && Number.isFinite(r.ci_high)).toBe(true);
    expect(r.warnings.length).toBeGreaterThan(0);
  });

  it("detects a sample ratio mismatch", () => {
    const r = evaluateAbTest({
      control: { visitors: 10000, conversions: 500 },
      variant: { visitors: 10600, conversions: 530 },
    });
    expect(r.srm_detected).toBe(true);
    expect(r.warnings.some((w) => /sample ratio/i.test(w))).toBe(true);
  });

  it("honors expected_split", () => {
    const r = evaluateAbTest({
      control: { visitors: 9000, conversions: 450 },
      variant: { visitors: 1000, conversions: 60 },
      expected_split: 0.9,
    });
    expect(r.srm_detected).toBe(false);
    expect(r.srm_p_value).toBeCloseTo(1, 9);
  });

  it("honors confidence for significance and the interval width", () => {
    const base = {
      control: { visitors: 10000, conversions: 500 },
      variant: { visitors: 10000, conversions: 570 },
    };
    const at95 = evaluateAbTest(base);
    const at99 = evaluateAbTest({ ...base, confidence: 0.99 });
    expect(at99.significant).toBe(false); // p = 0.0278 > 0.01
    expect(at99.ci_high - at99.ci_low).toBeGreaterThan(at95.ci_high - at95.ci_low);
  });

  it("warns when an arm has fewer than 30 conversions or non-conversions", () => {
    const r = evaluateAbTest({
      control: { visitors: 100, conversions: 10 },
      variant: { visitors: 100, conversions: 20 },
    });
    expect(r.warnings.some((w) => /30/.test(w))).toBe(true);
  });

  it("rejects invalid inputs with ToolInputError", () => {
    const ok = { visitors: 100, conversions: 10 };
    expect(() =>
      evaluateAbTest({ control: { visitors: 100, conversions: 101 }, variant: ok }),
    ).toThrow(ToolInputError);
    expect(() => evaluateAbTest({ control: ok, variant: { visitors: 0, conversions: 0 } })).toThrow(
      ToolInputError,
    );
    expect(() =>
      evaluateAbTest({ control: ok, variant: { visitors: 100.5, conversions: 1 } }),
    ).toThrow(ToolInputError);
    expect(() => evaluateAbTest({ control: ok, variant: ok, confidence: 0.5 })).toThrow(
      ToolInputError,
    );
    expect(() => evaluateAbTest({ control: ok, variant: ok, expected_split: 1 })).toThrow(
      ToolInputError,
    );
  });

  describe("parity with scipy/statsmodels", () => {
    for (const c of reference.ab_cases) {
      it(c.name, () => {
        const r = evaluateAbTest({
          control: c.control,
          variant: c.variant,
          confidence: c.confidence,
          expected_split: c.expected_split,
        });
        expect(Math.abs(r.p_value - c.p_value)).toBeLessThan(1e-6);
        expect(Math.abs(r.absolute_diff - c.absolute_diff)).toBeLessThan(1e-9);
        expect(Math.abs(r.ci_low - c.ci_low)).toBeLessThan(1e-6);
        expect(Math.abs(r.ci_high - c.ci_high)).toBeLessThan(1e-6);
        expect(Math.abs(r.srm_p_value - c.srm_p_value)).toBeLessThan(1e-6);
        expect(Math.abs(r.prob_variant_better - c.prob_variant_better_normal)).toBeLessThan(1e-6);
        // The normal approximation tracks the exact posterior probability closely
        // once each arm has enough conversions; with zero conversions it is rougher.
        const tolerance = c.name === "zero_control" ? 0.05 : 1e-3;
        expect(Math.abs(r.prob_variant_better - c.prob_variant_better_exact)).toBeLessThan(
          tolerance,
        );
      });
    }
  });
});

describe("planAbTest", () => {
  it("computes the sample size per variant", () => {
    expect(planAbTest({ baseline_rate: 0.1, mde_relative: 0.1 }).per_variant).toBe(14751);
    expect(planAbTest({ baseline_rate: 0.03, mde_relative: 0.2 }).per_variant).toBe(13914);
  });

  it("computes total and duration", () => {
    const r = planAbTest({ baseline_rate: 0.1, mde_relative: 0.1, daily_visitors: 1000 });
    expect(r.total).toBe(29502);
    expect(r.days).toBe(30); // ceil(29502 / 1000)
    expect(planAbTest({ baseline_rate: 0.1, mde_relative: 0.1 }).days).toBeNull();
  });

  it("applies a Bonferroni correction with more than two variants", () => {
    const r = planAbTest({ baseline_rate: 0.05, mde_relative: 0.15, variants: 4 });
    expect(r.total).toBe(r.per_variant * 4);
    expect(r.warnings.some((w) => /bonferroni/i.test(w))).toBe(true);
  });

  it("rejects invalid inputs with ToolInputError", () => {
    expect(() => planAbTest({ baseline_rate: 0.6, mde_relative: 0.9 })).toThrow(ToolInputError);
    expect(() => planAbTest({ baseline_rate: 0, mde_relative: 0.1 })).toThrow(ToolInputError);
    expect(() => planAbTest({ baseline_rate: 0.1, mde_relative: 0 })).toThrow(ToolInputError);
    expect(() => planAbTest({ baseline_rate: 0.1, mde_relative: 0.1, variants: 1 })).toThrow(
      ToolInputError,
    );
    expect(() => planAbTest({ baseline_rate: 0.1, mde_relative: 0.1, variants: 6 })).toThrow(
      ToolInputError,
    );
    expect(() => planAbTest({ baseline_rate: 0.1, mde_relative: 0.1, daily_visitors: 0 })).toThrow(
      ToolInputError,
    );
  });

  it("rejects an mde_relative so small that the variant rate equals the baseline", () => {
    expect(() => planAbTest({ baseline_rate: 0.03, mde_relative: 1e-17 })).toThrow(ToolInputError);
  });

  describe("parity with the reference formula", () => {
    for (const c of reference.sample_size) {
      it(`p1=${c.baseline_rate} mde=${c.mde_relative} k=${c.variants}`, () => {
        const r = planAbTest({
          baseline_rate: c.baseline_rate,
          mde_relative: c.mde_relative,
          alpha: c.alpha,
          power: c.power,
          variants: c.variants,
        });
        expect(r.per_variant).toBe(c.per_variant);
      });
    }
  });
});
