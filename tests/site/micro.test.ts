// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { COPIED_LABEL, wireCopyButton } from "../../site/src/copy";
import { revealOnScroll } from "../../site/src/reveal";
import { attachTabInk } from "../../site/src/tab-ink";

afterEach(() => {
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("attachTabInk", () => {
  it("puts one aria-hidden ink bar in the tab list and follows the selected tab", () => {
    const list = document.createElement("div");
    list.setAttribute("role", "tablist");
    const tabs = [0, 1].map((i) => {
      const tab = document.createElement("button");
      tab.setAttribute("role", "tab");
      tab.setAttribute("aria-selected", String(i === 0));
      Object.defineProperties(tab, {
        offsetLeft: { value: i * 100 },
        offsetTop: { value: 0 },
        offsetWidth: { value: 90 + i * 10 },
        offsetHeight: { value: 40 },
      });
      list.append(tab);
      return tab;
    });
    document.body.append(list);
    const ink = attachTabInk(list);
    const bar = list.querySelector<HTMLElement>(".tab-ink");
    expect(bar?.getAttribute("aria-hidden")).toBe("true");
    expect(list.querySelectorAll(".tab-ink")).toHaveLength(1);
    expect(bar?.style.getPropertyValue("--tab-x")).toBe("0");
    expect(bar?.style.getPropertyValue("--tab-w")).toBe("90");

    tabs[0]?.setAttribute("aria-selected", "false");
    tabs[1]?.setAttribute("aria-selected", "true");
    ink.update();
    expect(bar?.style.getPropertyValue("--tab-x")).toBe("100");
    expect(bar?.style.getPropertyValue("--tab-w")).toBe("100");
  });
});

function fakeWindow(reduce: boolean, innerHeight = 800): Window {
  return {
    innerHeight,
    IntersectionObserver: class {},
    matchMedia: (query: string) => ({ matches: reduce && query.includes("reduce") }),
  } as unknown as Window;
}

function blockAt(top: number): HTMLElement {
  const block = document.createElement("div");
  block.getBoundingClientRect = () => ({ top }) as DOMRect;
  return block;
}

describe("revealOnScroll", () => {
  it("hides nothing when the visitor prefers reduced motion", () => {
    const below = blockAt(2000);
    revealOnScroll([[below]], fakeWindow(true));
    expect(below.dataset.reveal).toBeUndefined();
  });

  it("only hides blocks that start below the screen, staggered within a group", () => {
    const observed: Element[] = [];
    vi.stubGlobal(
      "IntersectionObserver",
      class {
        observe(target: Element) {
          observed.push(target);
        }
        unobserve() {}
      },
    );
    const above = blockAt(100);
    const first = blockAt(1200);
    const second = blockAt(1400);
    revealOnScroll([[above, first, second]], fakeWindow(false));
    expect(above.dataset.reveal).toBeUndefined();
    expect(first.dataset.reveal).toBe("pending");
    expect(second.style.getPropertyValue("--reveal-delay")).toBe("160ms");
    expect(observed).toEqual([first, second]);
  });
});

describe("the copy button morph", () => {
  it("marks the button as copied, keeps its text readable, then restores it", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
    const button = document.createElement("button");
    button.textContent = " Copy URL ";
    document.body.append(button);
    wireCopyButton(button, () => "https://example.test/mcp");
    button.click();
    await vi.waitFor(() => expect(button.textContent).toBe(COPIED_LABEL));
    expect(button.hasAttribute("data-copied")).toBe(true);
    vi.advanceTimersByTime(2000);
    expect(button.textContent).toBe("Copy URL");
    expect(button.hasAttribute("data-copied")).toBe(false);
  });
});
