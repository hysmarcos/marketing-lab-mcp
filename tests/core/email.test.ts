import { describe, expect, it } from "vitest";
import data from "../../data/hillstrom_cells.json";
import { analyzeEmailTest, type EmailCell, type EmailData } from "../../src/core/email";
import { ToolInputError } from "../../src/server/tool";
import reference from "../fixtures/email_reference.json";

const hillstrom = data as EmailData;

describe("analyzeEmailTest parity with statsmodels and scipy", () => {
  for (const c of reference.cases) {
    const label = `${c.campaign} ${c.metric} ${c.segment_by ?? "overall"} ${c.segment}`;
    it(`matches the reference for ${label}`, () => {
      const out = analyzeEmailTest(hillstrom, {
        campaign: c.campaign as "mens" | "womens",
        metric: c.metric as "visit" | "conversion" | "spend",
        ...(c.segment_by ? { segment_by: c.segment_by as "zip_code" } : {}),
      });
      const row = out.rows.find((r) => r.segment === c.segment);
      expect(row).toBeDefined();
      if (!row) return;
      expect(row.n_control).toBe(c.n_control);
      expect(row.n_treatment).toBe(c.n_treatment);
      expect(Math.abs(row.p_value - c.p_value)).toBeLessThan(1e-6);
      expect(row.control_value).toBeCloseTo(c.control_value, 9);
      expect(row.treatment_value).toBeCloseTo(c.treatment_value, 9);
      expect(row.absolute_uplift).toBeCloseTo(c.absolute_uplift, 9);
      expect(row.relative_uplift).toBeCloseTo(c.relative_uplift as number, 7);
      expect(row.significant).toBe(c.significant);
    });
  }
});

describe("analyzeEmailTest defaults and shape", () => {
  it("defaults to mens, conversion, one row called 'all'", () => {
    const out = analyzeEmailTest(hillstrom, {});
    expect(out.campaign).toBe("mens");
    expect(out.metric).toBe("conversion");
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]?.segment).toBe("all");
    expect(out.source).toContain("Hillstrom");
    expect(out.source.toLowerCase()).toContain("aggregated");
  });

  it("returns Rural, Suburban and Urban when segmenting by zip_code", () => {
    const out = analyzeEmailTest(hillstrom, { segment_by: "zip_code" });
    expect(out.rows.map((r) => r.segment)).toEqual(["Rural", "Suburban", "Urban"]);
  });

  it.each(["history_segment", "channel", "newbie", "mens", "womens"] as const)(
    "segments by %s with row sizes that add up",
    (segmentBy) => {
      const all = analyzeEmailTest(hillstrom, {});
      const out = analyzeEmailTest(hillstrom, { segment_by: segmentBy });
      expect(out.rows.length).toBeGreaterThan(1);
      expect(out.rows.reduce((s, r) => s + r.n_treatment, 0)).toBe(all.rows[0]?.n_treatment);
      expect(out.rows.reduce((s, r) => s + r.n_control, 0)).toBe(all.rows[0]?.n_control);
    },
  );

  it("analyzes the womens campaign", () => {
    const out = analyzeEmailTest(hillstrom, { campaign: "womens", metric: "visit" });
    expect(out.campaign).toBe("womens");
    expect(out.rows[0]?.treatment_value).toBeGreaterThan(out.rows[0]?.control_value ?? 1);
  });
});

describe("analyzeEmailTest edge cases", () => {
  const cell = (arm: EmailCell["arm"], over: Partial<EmailCell>): EmailCell => ({
    arm,
    dimension: "overall",
    value: "all",
    n: 100,
    visits: 10,
    conversions: 0,
    spend_sum: 0,
    spend_sq_sum: 0,
    ...over,
  });
  const tiny = (cells: EmailCell[]): EmailData => ({ source: "x", license_note: "y", cells });

  it("warns and returns a null relative uplift when the control value is 0", () => {
    const out = analyzeEmailTest(
      tiny([cell("control", {}), cell("mens", { conversions: 4 }), cell("womens", {})]),
      {},
    );
    expect(out.rows[0]?.relative_uplift).toBeNull();
    expect(out.warnings.some((w) => w.includes("relative"))).toBe(true);
    expect(Number.isFinite(out.rows[0]?.p_value)).toBe(true);
  });

  it("gives p-value 1 for identical zero-spend arms", () => {
    const out = analyzeEmailTest(
      tiny([cell("control", {}), cell("mens", {}), cell("womens", {})]),
      { metric: "spend" },
    );
    expect(out.rows[0]?.p_value).toBe(1);
    expect(out.rows[0]?.significant).toBe(false);
  });

  it("warns about small segments", () => {
    const out = analyzeEmailTest(
      tiny([
        cell("control", { n: 40, visits: 4, conversions: 1 }),
        cell("mens", { n: 40, visits: 5, conversions: 2 }),
      ]),
      {},
    );
    expect(out.warnings.some((w) => w.toLowerCase().includes("conversions"))).toBe(true);
  });

  it("throws a ToolInputError when a segment has no cells for an arm", () => {
    const control = cell("control", { dimension: "zip_code", value: "Rural" });
    expect(() => analyzeEmailTest(tiny([control]), { segment_by: "zip_code" })).toThrow(
      ToolInputError,
    );
    expect(() => analyzeEmailTest(tiny([cell("control", {})]), { segment_by: "zip_code" })).toThrow(
      ToolInputError,
    );
  });
});
