import { TOOLS } from "../../src/server/tools";
import {
  type AbView,
  type AttributionView,
  abView,
  attributionView,
  type BudgetView,
  budgetView,
  type EmailView,
  emailView,
  type StoreView,
  storeView,
} from "./bento-data";
import { countUp } from "./countup";
import { motionAllowed } from "./motion";
import { breakAtUnderscores } from "./wbr";

/**
 * Draws the small views in "The nine tools". Each tile runs its tool's first example here, in the
 * browser, with the same code the server runs, and draws a few numbers from the result. A tile is
 * drawn when it scrolls into view; with motion allowed its bars grow and its headline counts up
 * once, otherwise it appears complete. The visual part is aria-hidden; a sentence with the same
 * numbers is there for screen readers.
 */

type Json = Record<string, unknown>;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

const SVG_NS = "http://www.w3.org/2000/svg";

function svg<K extends keyof SVGElementTagNameMap>(
  tag: K,
  attrs: Record<string, string>,
): SVGElementTagNameMap[K] {
  const node = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Runs a tool's example `index` and returns a plain copy of its structured output. */
export function runExample(name: string, index = 0): { args: Json; out: Json } {
  const spec = TOOLS.find((t) => t.name === name);
  const example = spec?.examples[index];
  if (!spec || !example) throw new Error(`No example ${index} for ${name}.`);
  const args = example.args as Json;
  return { args, out: JSON.parse(JSON.stringify(spec.run(args))) as Json };
}

const pct = (digits: number) =>
  new Intl.NumberFormat("en-US", {
    style: "percent",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
const pct0 = pct(0);
const pct1 = pct(1);
const pct2 = pct(2);
const signedPct = new Intl.NumberFormat("en-US", {
  style: "percent",
  maximumFractionDigits: 0,
  signDisplay: "exceptZero",
});
const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 });

function headline(value: string, label: string): HTMLElement {
  const box = el("div", "viz__headline");
  box.append(el("span", "viz__num", value), el("span", "viz__label", label));
  return box;
}

/** A bar that grows from its start when the view enters. `--i` staggers it. */
function grow(className: string, scale: number, index: number): HTMLElement {
  const bar = el("span", `viz__bar ${className}`);
  bar.style.setProperty("--scale", String(Math.max(0, Math.min(1, scale))));
  bar.style.setProperty("--i", String(index));
  bar.dataset.grow = "";
  return bar;
}

function spoken(text: string): HTMLElement {
  return el("p", "visually-hidden", text);
}

// Views -------------------------------------------------------------------------------------------

export function drawAb(view: AbView): HTMLElement {
  const box = el("div", "viz-ab");
  const W = 400;
  const H = 120;
  const plot = svg("svg", {
    class: "viz-ab__plot",
    viewBox: `0 0 ${W} ${H}`,
    preserveAspectRatio: "none",
  });
  const area = (points: [number, number][], ink: "a" | "b", i: number) => {
    const line = points.map(([x, y]) => `${(x * W).toFixed(1)},${(H - y * (H - 6)).toFixed(1)}`);
    const path = svg("path", {
      class: `viz-ab__area viz-ab__area--${ink}`,
      d: `M0,${H} L${line.join(" L")} L${W},${H} Z`,
    });
    path.style.setProperty("--i", String(i));
    path.dataset.rise = "";
    return path;
  };
  plot.append(area(view.control.points, "a", 0), area(view.variant.points, "b", 1));
  plot.append(
    svg("line", { class: "viz-ab__base", x1: "0", y1: String(H), x2: String(W), y2: String(H) }),
  );

  const keys = el("div", "viz-ab__keys");
  for (const [ink, label, rate] of [
    ["a", "Control", view.control.rate],
    ["b", "Variant", view.variant.rate],
  ] as const) {
    const key = el("span", `viz-ab__key viz-ab__key--${ink}`);
    const at = (rate - view.lo) / (view.hi - view.lo);
    key.style.setProperty("--at", String(Math.max(0.12, Math.min(0.88, at))));
    key.append(el("span", "viz__swatch"), `${label} ${pct2.format(rate)}`);
    keys.append(key);
  }
  const visual = el("div", "viz__visual");
  visual.setAttribute("aria-hidden", "true");
  visual.append(headline(pct1.format(view.probBetter), "chance the variant is better"), plot, keys);
  box.append(
    visual,
    spoken(
      `Control converts at ${pct2.format(view.control.rate)} and the variant at ` +
        `${pct2.format(view.variant.rate)}. The probability that the variant is better is ` +
        `${pct1.format(view.probBetter)}.`,
    ),
  );
  return box;
}

const CAMPAIGN: Record<string, string> = { mens: "Men's e-mail", womens: "Women's e-mail" };

export function drawEmail(view: EmailView): HTMLElement {
  const box = el("div", "viz-email");
  const visual = el("div", "viz__visual");
  visual.setAttribute("aria-hidden", "true");
  const campaign = CAMPAIGN[view.campaign] ?? view.campaign;
  const max = Math.max(view.control, view.treatment) || 1;
  const rows = el("div", "viz__rows");
  [
    ["No e-mail", view.control, "a"],
    [campaign, view.treatment, "b"],
  ].forEach(([label, value, ink], i) => {
    const row = el("div", "viz__row");
    row.append(
      el("span", "viz__row-label", String(label)),
      grow(`viz__bar--${ink}`, Number(value) / max, i),
      el("span", "viz__row-value", pct2.format(Number(value))),
    );
    rows.append(row);
  });
  visual.append(headline(signedPct.format(view.relativeUplift), `${view.metric} rate`), rows);
  box.append(
    visual,
    spoken(
      `${campaign}: ${view.metric} rate ${pct2.format(view.treatment)} against ` +
        `${pct2.format(view.control)} with no e-mail, ${signedPct.format(view.relativeUplift)}.`,
    ),
  );
  return box;
}

export function drawBudget(view: BudgetView): HTMLElement {
  const box = el("div", "viz-budget");
  const visual = el("div", "viz__visual");
  visual.setAttribute("aria-hidden", "true");
  const strips = el("div", "viz-budget__strips");
  let index = 0;
  for (const [side, label, ink] of [
    ["current", "Current", "a"],
    ["optimal", "Optimizer", "b"],
  ] as const) {
    const strip = el("div", "viz-budget__strip");
    strip.append(el("span", "viz-budget__side", label));
    const bar = el("div", "viz-budget__bar");
    for (const share of view.shares) {
      const value = share[side];
      if (value <= 0) continue;
      const seg = el("span", `viz-budget__seg viz-budget__seg--${ink}`);
      seg.style.flexGrow = String(value);
      seg.style.setProperty("--i", String(index++));
      seg.dataset.grow = "";
      if (value >= 0.14) seg.textContent = share.channel;
      bar.append(seg);
    }
    strip.append(bar);
    strips.append(strip);
  }
  const legend = el("dl", "viz-budget__legend");
  for (const share of view.shares) {
    const item = el("div", "viz-budget__item");
    item.append(
      el("dt", "", share.channel),
      el("dd", "", `${pct0.format(share.current)} to ${pct0.format(share.optimal)}`),
    );
    legend.append(item);
  }
  const gain = `${view.pct > 0 ? "+" : ""}${view.pct.toFixed(1)}%`;
  visual.append(headline(gain, "median media-driven sales, same budget"), strips, legend);
  box.append(
    visual,
    spoken(
      `Same weekly budget, split differently: ${view.shares
        .map((s) => `${s.channel} ${pct0.format(s.current)} to ${pct0.format(s.optimal)}`)
        .join(", ")}. Median media-driven sales change by ${gain}.`,
    ),
  );
  return box;
}

export function drawShop(view: StoreView): HTMLElement {
  const box = el("div", "viz-shop");
  const visual = el("div", "viz__visual");
  visual.setAttribute("aria-hidden", "true");
  const rows = el("div", "viz__rows");
  view.rows.forEach((row, i) => {
    const line = el("div", "viz__row");
    const label = el("span", "viz__row-label");
    label.append(breakAtUnderscores(row.key));
    line.append(
      label,
      grow("viz__bar--b", row.scale, i),
      el("span", "viz__row-value", `R$ ${compact.format(row.revenue)}`),
    );
    rows.append(line);
  });
  visual.append(rows);
  box.append(
    visual,
    spoken(
      `Top categories by revenue: ${view.rows
        .map((r) => `${r.key} R$ ${compact.format(r.revenue)}`)
        .join(", ")}.`,
    ),
  );
  return box;
}

export function drawAttribution(view: AttributionView): HTMLElement {
  const box = el("div", "viz-attr");
  const visual = el("div", "viz__visual");
  visual.setAttribute("aria-hidden", "true");
  const max = Math.max(...view.rows.flatMap((r) => [r.truth, r.lastTouch]), 0) || 1;
  const rows = el("div", "viz__rows");
  view.rows.forEach((row, i) => {
    const line = el("div", "viz__row viz__row--stacked");
    const label = el("span", "viz__row-label");
    label.append(breakAtUnderscores(row.channel));
    const track = el("span", "viz__track");
    track.append(
      grow("viz__bar--a", row.truth / max, i),
      grow("viz__bar--b", row.lastTouch / max, i),
    );
    line.append(label, track);
    rows.append(line);
  });
  const keys = el("div", "viz__keys");
  for (const [ink, label] of [
    ["a", "Truth"],
    ["b", "Last touch"],
  ] as const) {
    const key = el("span", `viz__key viz__key--${ink}`);
    key.append(el("span", "viz__swatch"), label);
    keys.append(key);
  }
  const pp = (value: number) => `${(value * 100).toFixed(1)} pp`;
  const error = pp(view.lastTouchError);
  // Every model's average miss, closest first: last touch is the long bar at the bottom.
  const worst = Math.max(...view.errors.map((e) => e.error), 0) || 1;
  const ranking = el("div", "viz__rows viz-attr__ranking");
  ranking.append(el("p", "viz__label", "Average miss by model"));
  view.errors.forEach((entry, i) => {
    const line = el("div", "viz__row");
    const label = el("span", "viz__row-label");
    label.append(breakAtUnderscores(entry.model));
    line.append(
      label,
      grow("viz__bar--b", entry.error / worst, i + view.rows.length),
      el("span", "viz__row-value", pp(entry.error)),
    );
    ranking.append(line);
  });
  visual.append(headline(error, "last touch's average miss per channel"), keys, rows, ranking);
  box.append(
    visual,
    spoken(
      `True share against last-touch credit: ${view.rows
        .map((r) => `${r.channel} ${pct0.format(r.truth)} against ${pct0.format(r.lastTouch)}`)
        .join(", ")}. Last touch misses by ${error} on average; ${view.best.model} lands ` +
        `closest, ${(view.best.error * 100).toFixed(1)} pp.`,
    ),
  );
  return box;
}

/** Builds the view for one tile from its tools' real output. */
export function drawView(kind: string): HTMLElement {
  switch (kind) {
    case "ab": {
      const { args, out } = runExample("ab_test_evaluate");
      return drawAb(abView(args, out));
    }
    case "email":
      return drawEmail(emailView(runExample("email_test_analyze").out));
    case "budget":
      return drawBudget(
        budgetView(runExample("budget_simulate").out, runExample("budget_optimize").out),
      );
    case "shop":
      return drawShop(storeView(runExample("store_sales").out));
    case "attribution":
      return drawAttribution(attributionView(runExample("attribution_compare").out));
    default:
      throw new Error(`Unknown view ${kind}.`);
  }
}

/** Fills one figure; `animate` plays its entrance (bars grow, headline counts up). */
export function fillFigure(figure: HTMLElement, animate = motionAllowed()): void {
  const body = figure.querySelector<HTMLElement>("[data-viz-body]");
  if (!body || figure.dataset.state === "drawn") return;
  try {
    body.replaceChildren(drawView(figure.dataset.viz ?? ""));
    figure.dataset.state = "drawn";
  } catch (error) {
    console.error(`Could not draw the ${figure.dataset.viz} tile.`, error);
    body.replaceChildren(
      el(
        "p",
        "viz__wait",
        "The example could not run here. Its tool still works in the playground.",
      ),
    );
    figure.dataset.state = "failed";
    return;
  }
  if (!animate) return;
  figure.dataset.enter = "";
  for (const num of figure.querySelectorAll<HTMLElement>(".viz__num")) countUp(num);
}

/** Draws each tile's view when it scrolls into view (all at once without an observer). */
export function mountBento(root: HTMLElement): void {
  const figures = [...root.querySelectorAll<HTMLElement>("[data-viz]")];
  if (!("IntersectionObserver" in window)) {
    for (const figure of figures) fillFigure(figure);
    return;
  }
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        fillFigure(entry.target as HTMLElement);
      }
    },
    { rootMargin: "0px 0px -12% 0px", threshold: 0.2 },
  );
  for (const figure of figures) observer.observe(figure);
}
