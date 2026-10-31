import { describe, expect, it } from "vitest";
import sampleJson from "../../data/journeys_sample.json";
import {
  type AttributionData,
  compareAttribution,
  type Journey,
  MODELS,
} from "../../src/core/attribution";
import { ToolInputError } from "../../src/server/tool";

const sample = sampleJson as AttributionData;
const EMPTY: AttributionData = { source: "", channels: [], truth: {}, journeys: [] };

const tiny: Journey[] = [
  { path: ["A", "B"], conversions: 1, nulls: 0 },
  { path: ["A"], conversions: 0, nulls: 1 },
  { path: ["B"], conversions: 1, nulls: 1 },
];

function credits(out: ReturnType<typeof compareAttribution>, model: (typeof MODELS)[number]) {
  return Object.fromEntries(Object.entries(out.models[model]).map(([k, v]) => [k, v.credit]));
}

describe("compareAttribution on hand-computed journeys", () => {
  const out = compareAttribution({ journeys: tiny }, EMPTY);

  it("gives the whole conversion to the last touch", () => {
    expect(credits(out, "last_touch")).toEqual({ A: 0, B: 2 });
  });
  it("gives the whole conversion to the first touch", () => {
    expect(credits(out, "first_touch")).toEqual({ A: 1, B: 1 });
  });
  it("splits the conversion equally over the touches", () => {
    expect(credits(out, "linear")).toEqual({ A: 0.5, B: 1.5 });
  });
  it("computes exact Shapley values", () => {
    expect(credits(out, "shapley")).toEqual({ A: 0.5, B: 1.5 });
  });
  it("uses removal effects 1/3 and 1 for the Markov chain", () => {
    expect(credits(out, "markov")).toEqual({ A: 0.5, B: 1.5 });
  });
  it("reports shares, no truth, and the source", () => {
    expect(out.models.last_touch.B?.share).toBe(1);
    expect(out.total_conversions).toBe(2);
    expect(out.truth).toBeNull();
    expect(out.error_vs_truth).toBeNull();
    expect(out.source).toBe("user input");
    expect(out.channels).toEqual(["A", "B"]);
  });
});

describe("compareAttribution edge cases", () => {
  it("collapses consecutive repeats in the Markov chain but not in the linear split", () => {
    const out = compareAttribution(
      {
        journeys: [
          { path: ["A", "A", "B"], conversions: 1, nulls: 0 },
          { path: ["B"], conversions: 0, nulls: 1 },
        ],
      },
      EMPTY,
    );
    expect(credits(out, "linear")).toEqual({ A: 0.6667, B: 0.3333 });
    // Chain: start->A, start->B, A->B, B->conv 1/2, B->null 1/2, so P(conv) = 1/2.
    // Removing A leaves 1/4 (effect 1/2); removing B leaves 0 (effect 1). Shares 1/3 and 2/3.
    expect(credits(out, "markov")).toEqual({ A: 0.3333, B: 0.6667 });
  });

  it("gives zero credit and a warning, never NaN, when nobody converts", () => {
    const out = compareAttribution(
      { journeys: [{ path: ["A", "B"], conversions: 0, nulls: 5 }] },
      EMPTY,
    );
    expect(out.total_conversions).toBe(0);
    for (const m of MODELS) {
      for (const v of Object.values(out.models[m])) {
        expect(v).toEqual({ credit: 0, share: 0 });
        expect(Number.isFinite(v.credit) && Number.isFinite(v.share)).toBe(true);
      }
    }
    expect(out.warnings.join(" ")).toMatch(/no conversions/i);
  });

  it("gives share 1 to a single channel in every model", () => {
    const out = compareAttribution(
      { journeys: [{ path: ["only", "only"], conversions: 3, nulls: 2 }] },
      EMPTY,
    );
    for (const m of MODELS) expect(out.models[m].only?.share).toBe(1);
  });

  it("trims channel names and treats case as significant", () => {
    const out = compareAttribution(
      {
        journeys: [
          { path: [" A ", "a"], conversions: 1, nulls: 0 },
          { path: ["A"], conversions: 1, nulls: 0 },
        ],
      },
      EMPTY,
    );
    expect(out.channels).toEqual(["A", "a"]);
  });

  it("accepts exactly 12 channels and rejects 13", () => {
    const names = Array.from({ length: 13 }, (_, i) => `c${i}`);
    const rows = (list: string[]): Journey[] =>
      list.map((c) => ({ path: [c], conversions: 1, nulls: 0 }));
    const ok = compareAttribution({ journeys: rows(names.slice(0, 12)) }, EMPTY);
    expect(ok.channels).toHaveLength(12);
    for (const m of MODELS) {
      expect(Object.values(ok.models[m]).reduce((s, v) => s + v.credit, 0)).toBeCloseTo(12, 6);
    }
    expect(() => compareAttribution({ journeys: rows(names) }, EMPTY)).toThrow(ToolInputError);
  });

  it("makes credits add up to the conversions in every model", () => {
    const out = compareAttribution({}, sample);
    for (const m of MODELS) {
      const sum = Object.values(out.models[m]).reduce((s, v) => s + v.credit, 0);
      expect(sum).toBeCloseTo(out.total_conversions, 1);
    }
  });

  it.each([
    ["no rows", []],
    ["an empty path", [{ path: [], conversions: 1, nulls: 0 }]],
    ["a 21-step path", [{ path: Array(21).fill("A"), conversions: 1, nulls: 0 }]],
    ["a blank channel", [{ path: ["A", "  "], conversions: 1, nulls: 0 }]],
    ["a fractional count", [{ path: ["A"], conversions: 1.5, nulls: 0 }]],
    ["a negative count", [{ path: ["A"], conversions: 1, nulls: -1 }]],
  ])("rejects %s", (_name, journeys) => {
    expect(() => compareAttribution({ journeys: journeys as Journey[] }, EMPTY)).toThrow(
      ToolInputError,
    );
  });

  it("rejects more than 5000 rows", () => {
    const journeys = Array.from({ length: 5001 }, () => ({
      path: ["A"],
      conversions: 1,
      nulls: 0,
    }));
    expect(() => compareAttribution({ journeys }, EMPTY)).toThrow(ToolInputError);
  });
});

describe("compareAttribution on the simulated sample", () => {
  const out = compareAttribution({}, sample);

  it("reads the sample by default and labels it", () => {
    expect(out.source).toBe("simulated journeys (seed 42), marketing-lab-mcp");
    expect(out.channels).toEqual(sample.channels);
    expect(out.truth).not.toBeNull();
    expect(out.warnings).toEqual([]);
  });

  it("scores Markov closer to the truth than last touch", () => {
    const errors = out.error_vs_truth;
    expect(errors).not.toBeNull();
    expect(errors?.markov).toBeLessThan(errors?.last_touch ?? 0);
  });

  it("shows last touch over-crediting direct and under-crediting display", () => {
    expect(out.models.last_touch.direct?.share).toBeGreaterThan(out.truth?.direct ?? 1);
    expect(out.models.last_touch.display?.share).toBeLessThan(out.truth?.display ?? 0);
  });
});
