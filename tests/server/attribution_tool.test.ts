import type { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TOOLS } from "../../src/server/tools";
import { attributionCompare } from "../../src/server/tools/attribution_compare";
import { connectInMemory } from "./helpers";

let client: Client;

beforeAll(async () => {
  client = await connectInMemory();
});

afterAll(async () => {
  await client.close();
});

const summaryOf = (r: { content?: unknown }) => (r.content as { text: string }[])[0]?.text ?? "";

type Out = {
  channels: string[];
  total_conversions: number;
  truth: Record<string, number> | null;
  error_vs_truth: Record<string, number> | null;
  source: string;
  warnings: string[];
};

describe("attribution_compare", () => {
  it("is the ninth tool, registered right after lead_funnel", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names.indexOf("attribution_compare")).toBe(names.indexOf("lead_funnel") + 1);
    expect(TOOLS).toHaveLength(9);
  });

  it("answers with no arguments using the simulated sample", async () => {
    const result = await client.callTool({ name: "attribution_compare", arguments: {} });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as Out;
    expect(out.source).toBe("simulated journeys (seed 42), marketing-lab-mcp");
    expect(out.channels).toHaveLength(6);
    expect(out.truth).not.toBeNull();
    expect(out.error_vs_truth?.markov).toBeLessThan(out.error_vs_truth?.last_touch ?? 0);
    const text = summaryOf(result);
    expect(text).toContain("SIMULATED");
    expect(text.length).toBeLessThanOrEqual(1200);
  });

  it("scores the user's own journeys, with no truth", async () => {
    const result = await client.callTool({
      name: "attribution_compare",
      arguments: {
        journeys: [
          { path: ["A", "B"], conversions: 1, nulls: 0 },
          { path: ["A"], conversions: 0, nulls: 1 },
          { path: ["B"], conversions: 1, nulls: 1 },
        ],
      },
    });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as Out;
    expect(out.source).toBe("user input");
    expect(out.truth).toBeNull();
    expect(out.error_vs_truth).toBeNull();
    expect(summaryOf(result)).not.toContain("SIMULATED");
  });

  it("returns a tool error for 13 distinct channels", async () => {
    const journeys = Array.from({ length: 13 }, (_, i) => ({
      path: [`c${i}`],
      conversions: 1,
      nulls: 0,
    }));
    const result = await client.callTool({ name: "attribution_compare", arguments: { journeys } });
    expect(result.isError).toBe(true);
    expect(summaryOf(result)).toContain("12");
  });

  it("rejects bad shapes: empty path, long path, too many rows, fractional counts, typos", async () => {
    const row = { path: ["A"], conversions: 1, nulls: 0 };
    const bad: unknown[] = [
      { journeys: [{ ...row, path: [] }] },
      { journeys: [{ ...row, path: Array(21).fill("A") }] },
      { journeys: Array(2001).fill(row) },
      { journeys: [] },
      { journeys: [{ ...row, conversions: 0.5 }] },
      { journeys: [{ ...row, nulls: -1 }] },
      { journeys: [{ ...row, extra: 1 }] },
      { journey: [row] },
    ];
    for (const args of bad) {
      const r = await client.callTool({
        name: "attribution_compare",
        arguments: args as Record<string, unknown>,
      });
      expect(r.isError).toBe(true);
    }
  });

  it("keeps the summary within the limit for 12 channels", () => {
    const journeys = Array.from({ length: 12 }, (_, i) => ({
      path: [`a_rather_long_channel_name_${i}`],
      conversions: 10 + i,
      nulls: 5,
    }));
    const out = attributionCompare.run(attributionCompare.input.parse({ journeys }));
    expect(attributionCompare.summarize(out).length).toBeLessThanOrEqual(1200);
  });

  it("mentions the models, the simulated sample and the caps in the description", () => {
    const d = attributionCompare.description;
    for (const word of ["last_touch", "first_touch", "linear", "markov", "shapley", "SIMULATED"]) {
      expect(d).toContain(word);
    }
    expect(d).toContain("2000");
    expect(d).toContain("12");
  });
});

const clock = (globalThis as unknown as { performance: { now(): number } }).performance;

function medianMs(run: () => void): number {
  // A few untimed runs first: the first calls are slow while the engine compiles the hot loops.
  for (let i = 0; i < 5; i++) run();
  const times: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = clock.now();
    run();
    times.push(clock.now() - start);
  }
  times.sort((a, b) => a - b);
  return ((times[9] ?? 0) + (times[10] ?? 0)) / 2;
}

describe("attribution_compare CPU budget", () => {
  it("scores the sample in under 5 ms (median of 20 runs)", () => {
    const median = medianMs(() => {
      const out = attributionCompare.run(attributionCompare.input.parse({}));
      attributionCompare.summarize(out);
    });
    expect(median).toBeLessThan(5);
  });

  it("parses and scores the worst case (2000 journeys, 12 channels, 20 touches) in under 5 ms", () => {
    const journeys = Array.from({ length: 2000 }, (_, i) => ({
      path: Array.from({ length: 20 }, (_, k) => `channel_${(i * 7 + k * 3 + (i % 5)) % 12}`),
      conversions: 1 + (i % 3),
      nulls: 5 + (i % 7),
    }));
    const median = medianMs(() => {
      const parsed = attributionCompare.input.parse({ journeys });
      const out = attributionCompare.run(parsed);
      expect(out.channels).toHaveLength(12);
      attributionCompare.summarize(out);
    });
    expect(median).toBeLessThan(5);
  });
});
