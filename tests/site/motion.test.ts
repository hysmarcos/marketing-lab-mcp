import { describe, expect, it } from "vitest";
import { motionAllowed } from "../../site/src/motion";

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
