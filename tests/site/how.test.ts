// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { type HowEnvironment, pickHowMotion, setActiveStep, setupHow } from "../../site/src/how";
import { TOOLS } from "../../src/server/tools";

const html = readFileSync(resolve(process.cwd(), "site/index.html"), "utf8");

function page(): Document {
  return new DOMParser().parseFromString(html, "text/html");
}

function scene(doc: Document = page()): HTMLElement {
  const node = doc.querySelector<HTMLElement>("[data-how]");
  if (!node) throw new Error("no [data-how] scene");
  return node;
}

const env = (over: Partial<HowEnvironment>): HowEnvironment => ({
  reducedMotion: false,
  scrollTimelines: true,
  observer: true,
  ...over,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pickHowMotion", () => {
  it("is static with reduced motion, whatever the browser supports", () => {
    expect(pickHowMotion(env({ reducedMotion: true }))).toBe("static");
  });

  it("prefers scroll-driven animations, then the observer, then static", () => {
    expect(pickHowMotion(env({}))).toBe("scroll");
    expect(pickHowMotion(env({ scrollTimelines: false }))).toBe("observer");
    expect(pickHowMotion(env({ scrollTimelines: false, observer: false }))).toBe("static");
  });
});

describe("the how-it-works scene", () => {
  it("ships in its final, static state", () => {
    expect(scene().dataset.motion).toBe("static");
  });

  it("stays static, with no active step, when the visitor prefers reduced motion", () => {
    const node = scene();
    setupHow(node, env({ reducedMotion: true }));
    expect(node.dataset.motion).toBe("static");
    expect(node.querySelector("[data-active]")).toBeNull();
  });

  it("hands the scene to CSS when scroll-driven animations exist", () => {
    const node = scene();
    setupHow(node, env({}));
    expect(node.dataset.motion).toBe("scroll");
  });

  it("falls back to an observer that lights the lane of the step on screen", () => {
    let callback: IntersectionObserverCallback = () => {};
    const observed: Element[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        constructor(cb: IntersectionObserverCallback) {
          callback = cb;
        }
        observe(target: Element) {
          observed.push(target);
        }
        disconnect() {}
      },
    );
    const node = scene();
    setupHow(node, env({ scrollTimelines: false }));
    expect(node.dataset.motion).toBe("observer");
    expect(observed).toHaveLength(3);

    const second = observed[1] as Element;
    callback([{ target: second, isIntersecting: true } as IntersectionObserverEntry], {} as never);
    expect(node.dataset.active).toBe("2");
    expect(node.querySelector('[data-lane="2"]')?.hasAttribute("data-active")).toBe(true);
    expect(node.querySelector('[data-hit="2"]')?.hasAttribute("data-active")).toBe(true);
    expect(node.querySelectorAll("[data-active]")).toHaveLength(2);

    callback([{ target: second, isIntersecting: false } as IntersectionObserverEntry], {} as never);
    expect(node.querySelectorAll("[data-active]")).toHaveLength(0);
  });

  it("marks one lane and one tool per step", () => {
    const node = scene();
    for (const step of [1, 2, 3]) {
      setActiveStep(node, step);
      const active = [...node.querySelectorAll<HTMLElement>("[data-active]")];
      expect(active.map((el) => el.dataset.lane ?? el.dataset.hit)).toEqual([
        String(step),
        String(step),
      ]);
    }
  });
});

describe("the messages on the wires", () => {
  const steps = [...scene().querySelectorAll<HTMLElement>("[data-step]")];

  it("are real tools/call requests with each tool's first example", () => {
    expect(steps).toHaveLength(3);
    for (const step of steps) {
      const text = step.querySelector("[data-how-message]")?.textContent ?? "";
      const message = JSON.parse(text);
      expect(message.jsonrpc).toBe("2.0");
      expect(message.method).toBe("tools/call");
      const tool = TOOLS.find((t) => t.name === message.params.name);
      expect(tool, message.params.name).toBeDefined();
      expect(message.params.arguments).toEqual(tool?.examples[0]?.args);
    }
  });

  it("light the tool they call in the server's list", () => {
    const node = scene();
    const listed = [...node.querySelectorAll(".how__tools li")].map((li) => li.textContent);
    expect(listed).toEqual(TOOLS.map((t) => t.name));
    for (const step of steps) {
      const name = JSON.parse(step.querySelector("[data-how-message]")?.textContent ?? "").params
        .name;
      const hit = node.querySelector(`[data-hit="${step.dataset.step}"]`);
      expect(hit?.textContent).toBe(name);
    }
  });

  it("use no em or en dashes", () => {
    const text = scene().closest("section")?.textContent ?? "";
    expect(text).not.toMatch(/[–—]/);
  });
});
