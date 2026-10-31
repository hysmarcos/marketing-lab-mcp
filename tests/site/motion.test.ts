import { describe, expect, it } from "vitest";
import { motionAllowed, staggerDelays } from "../../site/src/motion";

function fakeWindow(reduce: boolean | undefined): Window {
  if (reduce === undefined) return {} as Window;
  return {
    matchMedia: (query: string) => ({ matches: reduce && query.includes("reduce") }),
  } as unknown as Window;
}

describe("motionAllowed", () => {
  it("is false when the visitor prefers reduced motion", () => {
    expect(motionAllowed(fakeWindow(true))).toBe(false);
  });

  it("is true otherwise", () => {
    expect(motionAllowed(fakeWindow(false))).toBe(true);
  });

  it("is false when the page cannot ask", () => {
    expect(motionAllowed(fakeWindow(undefined))).toBe(false);
  });
});

describe("staggerDelays", () => {
  it("spaces short lists by the step", () => {
    expect(staggerDelays(3, 70, 240)).toEqual([0, 70, 140]);
  });

  it("squeezes long lists so the last one starts by the cap", () => {
    const delays = staggerDelays(11, 70, 240);
    expect(delays).toHaveLength(11);
    expect(delays.at(-1)).toBe(240);
    expect(delays[1]).toBe(24);
  });

  it("gives a single item no delay", () => {
    expect(staggerDelays(1, 70, 240)).toEqual([0]);
    expect(staggerDelays(0, 70, 240)).toEqual([]);
  });
});
