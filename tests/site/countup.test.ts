// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { countUp, numberParts, textAt } from "../../site/src/countup";

describe("numberParts and textAt", () => {
  it.each([
    ["5.68%", "0.00%"],
    ["+119%", "+0%"],
    ["R$ 1,229,557.5", "R$ 0.0"],
    ["15.9 pp", "0.0 pp"],
    ["$3,486,914", "$0"],
  ])("counts %s from %s and ends on exactly the original", (text, start) => {
    const parts = numberParts(text);
    expect(parts).toBeDefined();
    if (!parts) return;
    expect(textAt(parts, 0)).toBe(start);
    expect(textAt(parts, 1)).toBe(text);
  });

  it("keeps grouping while counting", () => {
    const parts = numberParts("R$ 1,229,558");
    if (!parts) throw new Error("no parts");
    expect(textAt(parts, 0.5)).toBe("R$ 614,779");
  });

  it("finds nothing in text without a number", () => {
    expect(numberParts("Yes")).toBeUndefined();
  });
});

describe("countUp", () => {
  it("leaves the final text in place at once with reduced motion", () => {
    const raf = vi.fn();
    vi.stubGlobal("requestAnimationFrame", raf);
    const node = document.createElement("span");
    node.textContent = "99.7%";
    countUp(node, { motion: false });
    expect(node.textContent).toBe("99.7%");
    expect(raf).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("starts from zero and ends on the exact original text", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => frames.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {});
    const node = document.createElement("span");
    node.textContent = "+33.2%";
    countUp(node, { motion: true, duration: 400 });
    expect(node.textContent).toBe("+0.0%");
    frames.shift()?.(0);
    frames.shift()?.(200);
    expect(node.textContent).not.toBe("+33.2%");
    frames.shift()?.(500);
    expect(node.textContent).toBe("+33.2%");
    expect(frames).toHaveLength(0);
    vi.unstubAllGlobals();
  });
});
