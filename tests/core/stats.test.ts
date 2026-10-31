import { describe, expect, it } from "vitest";
import {
  chiSquare1Sf,
  normalCdf,
  normalPpf,
  regularizedIncompleteBeta,
  studentTSf,
  welchTTest,
} from "../../src/core/stats";
import reference from "../fixtures/abtest_reference.json";
import { expectCloseTail } from "./closeTo";

const TOL = 1e-6;

describe("normalCdf", () => {
  for (const { z, value } of reference.normal_cdf) {
    it(`matches scipy at z=${z}`, () => {
      expectCloseTail(normalCdf(z), value, TOL);
    });
  }
  it("keeps relative accuracy in the far tail", () => {
    expect(normalCdf(-8) / 6.220960574271785e-16).toBeCloseTo(1, 6);
  });
});

describe("normalPpf", () => {
  for (const { p, value } of reference.normal_ppf) {
    it(`matches scipy at p=${p}`, () => {
      expect(Math.abs(normalPpf(p) - value)).toBeLessThan(TOL);
    });
  }
  it("inverts normalCdf", () => {
    for (const z of [-3, -1.2, 0, 0.7, 2.4]) {
      expect(normalPpf(normalCdf(z))).toBeCloseTo(z, 9);
    }
  });
  it("rejects probabilities outside (0, 1)", () => {
    expect(() => normalPpf(0)).toThrow(RangeError);
    expect(() => normalPpf(1)).toThrow(RangeError);
    expect(() => normalPpf(Number.NaN)).toThrow(RangeError);
  });
});

describe("chiSquare1Sf", () => {
  for (const { x, value } of reference.chi2_1_sf) {
    it(`matches scipy at x=${x}`, () => {
      expectCloseTail(chiSquare1Sf(x), value, TOL);
    });
  }
  it("is 1 for x <= 0", () => {
    expect(chiSquare1Sf(-1)).toBe(1);
  });
});

describe("regularizedIncompleteBeta", () => {
  for (const { x, a, b, value } of reference.betainc) {
    it(`matches scipy.special.betainc(${a}, ${b}, ${x})`, () => {
      expectCloseTail(regularizedIncompleteBeta(x, a, b), value, TOL);
    });
  }
  it("handles the endpoints", () => {
    expect(regularizedIncompleteBeta(0, 2, 3)).toBe(0);
    expect(regularizedIncompleteBeta(1, 2, 3)).toBe(1);
  });
  it("rejects x outside [0, 1] and non-positive shapes", () => {
    expect(() => regularizedIncompleteBeta(1.5, 2, 3)).toThrow(RangeError);
    expect(() => regularizedIncompleteBeta(0.5, 0, 3)).toThrow(RangeError);
  });
});

describe("studentTSf", () => {
  for (const { t, df, value } of reference.student_t_sf) {
    it(`matches scipy at t=${t}, df=${df}`, () => {
      expectCloseTail(studentTSf(t, df), value, TOL);
    });
  }
  it("reproduces the Welch p-values from scipy", () => {
    for (const c of reference.welch) {
      const p = 2 * studentTSf(Math.abs(c.t), c.df);
      expectCloseTail(p, c.p_value, TOL);
    }
  });
});

describe("welchTTest", () => {
  it("reproduces scipy's t, df and p-value from summary statistics", () => {
    for (const c of reference.welch) {
      const r = welchTTest(c.mean1, c.std1 ** 2, c.n1, c.mean2, c.std2 ** 2, c.n2);
      expect(r.t).toBeCloseTo(c.t, 9);
      expect(r.df).toBeCloseTo(c.df, 6);
      expectCloseTail(r.pValue, c.p_value, TOL);
      expect(r.degenerate).toBe(false);
    }
  });
  it("gives p = 1 when both variances are 0 and rejects samples smaller than 2", () => {
    const r = welchTTest(0, 0, 10, 0, 0, 10);
    expect(r.pValue).toBe(1);
    expect(r.degenerate).toBe(true);
    expect(() => welchTTest(0, 1, 1, 0, 1, 10)).toThrow(RangeError);
  });
});
