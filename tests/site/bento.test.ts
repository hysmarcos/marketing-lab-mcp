// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { drawView, fillFigure, runExample } from "../../site/src/bento";
import {
  abView,
  attributionView,
  budgetView,
  emailView,
  storeView,
} from "../../site/src/bento-data";
import { onPickTool, pickerReady, pickTool, resetPicker } from "../../site/src/picker";
import { resetSharedSession, setPlaygroundStarter } from "../../site/src/session";
import { wireToolLinks } from "../../site/src/tool-links";
import { TOOLS } from "../../src/server/tools";

const html = readFileSync(resolve(process.cwd(), "site/index.html"), "utf8");
const page = () => new DOMParser().parseFromString(html, "text/html");

afterEach(() => {
  resetPicker();
  resetSharedSession();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("the tile views compute from real tool output", () => {
  it("A/B: two curves peaking at the tool's own conversion rates", () => {
    const { args, out } = runExample("ab_test_evaluate");
    const view = abView(args, out);
    expect(view.control.rate).toBe(out.control_rate);
    expect(view.variant.rate).toBe(out.variant_rate);
    expect(view.probBetter).toBe(out.prob_variant_better);
    for (const curve of [view.control, view.variant]) {
      const [peakX] = curve.points.reduce((best, p) => (p[1] > best[1] ? p : best));
      const peakRate = view.lo + peakX * (view.hi - view.lo);
      // The sampled peak sits within one sample step of the rate.
      expect(Math.abs(peakRate - curve.rate)).toBeLessThan((view.hi - view.lo) / 32);
      for (const [, y] of curve.points) expect(y).toBeLessThanOrEqual(1);
    }
    expect(view.lo).toBeLessThan(view.control.rate);
    expect(view.hi).toBeGreaterThan(view.variant.rate);
  });

  it("e-mail: the overall row of the men's campaign", () => {
    const { out } = runExample("email_test_analyze");
    const view = emailView(out);
    const row = (out.rows as Record<string, unknown>[]).find((r) => r.segment === "all");
    expect(view.control).toBe(row?.control_value);
    expect(view.treatment).toBe(row?.treatment_value);
    expect(view.relativeUplift).toBe(row?.relative_uplift);
  });

  it("budget: current and optimal shares each add up to one, gain from the optimizer", () => {
    const simulated = runExample("budget_simulate").out;
    const optimized = runExample("budget_optimize").out;
    const view = budgetView(simulated, optimized);
    const sum = (key: "current" | "optimal") => view.shares.reduce((s, x) => s + x[key], 0);
    expect(sum("current")).toBeCloseTo(1, 10);
    expect(sum("optimal")).toBeCloseTo(1, 10);
    expect(view.shares.map((s) => s.channel)).toEqual(
      Object.keys(simulated.weekly_spend as object),
    );
    expect(view.pct).toBe((optimized.vs_current as { pct: number }).pct);
  });

  it("store: the top five categories, scaled to the largest", () => {
    const { out } = runExample("store_sales");
    const view = storeView(out);
    const rows = out.rows as { key: string; revenue: number }[];
    expect(view.rows.map((r) => r.key)).toEqual(rows.slice(0, 5).map((r) => r.key));
    expect(view.rows[0]?.scale).toBe(1);
    expect(view.totalRevenue).toBe((out.total as { revenue: number }).revenue);
  });

  it("attribution: the truth against last touch, and the models ranked by error", () => {
    const { out } = runExample("attribution_compare");
    const view = attributionView(out);
    const truth = out.truth as Record<string, number>;
    expect(view.rows.map((r) => r.truth)).toEqual(Object.values(truth));
    const errors = out.error_vs_truth as Record<string, number>;
    expect(view.lastTouchError).toBe(errors.last_touch);
    expect(view.errors.map((e) => e.error)).toEqual(Object.values(errors).sort((a, b) => a - b));
    expect(view.best).toEqual(view.errors[0]);
  });
});

describe("the tiles", () => {
  it("name each tool once, all nine, with the example their view runs", () => {
    const doc = page();
    const names = [...doc.querySelectorAll<HTMLElement>(".bento__tool")].map((b) => b.dataset.tool);
    expect([...names].sort()).toEqual(TOOLS.map((t) => t.name).sort());
    for (const figure of doc.querySelectorAll<HTMLElement>("[data-viz]")) {
      const caption = figure.querySelector("figcaption")?.textContent ?? "";
      for (const name of (figure.dataset.examples ?? "").split(" ")) {
        const label = TOOLS.find((t) => t.name === name)?.examples[0]?.label;
        expect(caption).toContain(name);
        expect(caption).toContain(`"${label}"`);
      }
    }
  });

  it("break tool names after underscores", () => {
    const button = page().querySelector('.bento__tool[data-tool="email_test_analyze"]');
    expect(button?.querySelectorAll("wbr")).toHaveLength(1);
  });

  it.each(["ab", "email", "budget", "shop", "attribution"])(
    "draws the %s view with a spoken summary and an aria-hidden picture",
    (kind) => {
      const view = drawView(kind);
      expect(view.querySelector(".viz__visual")?.getAttribute("aria-hidden")).toBe("true");
      expect(view.querySelector(".visually-hidden")?.textContent).toMatch(/\d/);
    },
  );

  it("shows the final view at once with reduced motion: no entrance, final numbers", () => {
    const figure = page().querySelector<HTMLElement>('[data-viz="ab"]') as HTMLElement;
    document.body.append(figure);
    fillFigure(figure, false);
    expect(figure.dataset.state).toBe("drawn");
    expect(figure.hasAttribute("data-enter")).toBe(false);
    const { out } = runExample("ab_test_evaluate");
    const expected = new Intl.NumberFormat("en-US", {
      style: "percent",
      minimumFractionDigits: 1,
      maximumFractionDigits: 1,
    }).format(out.prob_variant_better as number);
    expect(figure.querySelector(".viz__num")?.textContent).toBe(expected);
  });

  it("plays the entrance when motion is allowed", () => {
    const figure = page().querySelector<HTMLElement>('[data-viz="email"]') as HTMLElement;
    document.body.append(figure);
    fillFigure(figure, true);
    expect(figure.hasAttribute("data-enter")).toBe(true);
    expect(figure.querySelectorAll("[data-grow]").length).toBeGreaterThan(0);
  });

  it("says so when a view cannot be drawn", () => {
    const figure = document.createElement("figure");
    figure.dataset.viz = "nope";
    const body = document.createElement("div");
    body.setAttribute("data-viz-body", "");
    figure.append(body);
    vi.spyOn(console, "error").mockImplementation(() => {});
    fillFigure(figure, false);
    expect(figure.dataset.state).toBe("failed");
    expect(figure.textContent).toContain("playground");
  });
});

describe("opening a tool in the playground", () => {
  it("waits for the playground, then selects the tool and focuses it", async () => {
    const root = document.createElement("div");
    root.innerHTML = '<button data-tool="lead_funnel">lead_funnel</button>';
    const target = document.createElement("section");
    target.scrollIntoView = vi.fn();
    document.body.append(root, target);
    const starter = vi.fn();
    setPlaygroundStarter(starter);
    wireToolLinks(root, target);

    (root.querySelector("button") as HTMLButtonElement).click();
    expect(starter).toHaveBeenCalled();
    expect(target.scrollIntoView).toHaveBeenCalled();
    expect(pickerReady()).toBe(false);

    const picked = document.createElement("button");
    document.body.append(picked);
    const seen: string[] = [];
    onPickTool((name) => {
      seen.push(name);
      return picked;
    });
    await vi.waitFor(() => expect(document.activeElement).toBe(picked));
    expect(seen).toEqual(["lead_funnel"]);
  });

  it("applies picks made before the playground was ready, in order", async () => {
    const first = pickTool("ab_test_plan");
    const second = pickTool("store_sales");
    const seen: string[] = [];
    onPickTool((name) => {
      seen.push(name);
      return undefined;
    });
    await Promise.all([first, second]);
    expect(seen).toEqual(["ab_test_plan", "store_sales"]);
    expect(pickerReady()).toBe(true);
  });
});
