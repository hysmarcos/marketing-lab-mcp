import { describe, expect, it } from "vitest";
import { TOOLS } from "../../src/server/tools";

const WARM_UP_RUNS = 5;
const TIMED_RUNS = 20;
const BUDGET_MS = 5;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

describe("tool run() speed", () => {
  for (const spec of TOOLS) {
    for (const example of spec.examples) {
      it(`${spec.name} / ${example.label}: median under ${BUDGET_MS} ms`, () => {
        for (let i = 0; i < WARM_UP_RUNS; i++) spec.run(example.args);
        const times: number[] = [];
        for (let i = 0; i < TIMED_RUNS; i++) {
          const start = performance.now();
          spec.run(example.args);
          times.push(performance.now() - start);
        }
        expect(median(times)).toBeLessThan(BUDGET_MS);
      });
    }
  }
});
