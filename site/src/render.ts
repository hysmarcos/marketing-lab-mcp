import { humanize } from "./forms";

/**
 * One generic renderer for every tool's `structuredContent`: a summary line, comparison bars in
 * the two inks (A = control / current / truth, B = variant / plan / model), the headline figures,
 * tables for lists of rows and for small records, the warnings, the source and the raw JSON.
 * A few small helpers recognise shapes (control vs treatment, current vs plan, model shares vs
 * truth); there are no per-tool views. All text goes in with textContent: results can echo
 * strings the visitor typed.
 */

type Json = Record<string, unknown>;

interface Context {
  root: Json;
  parent?: string;
}

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

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isScalar(value: unknown): value is string | number | boolean | null {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

// Numbers -----------------------------------------------------------------------------------------

const PERCENT_KEY =
  /(^|_)(rate|share|lift|uplift|prob|ci_low|ci_high|absolute_diff|split|confidence)(_|$)/;
const PERCENT_PARENTS = new Set(["truth", "error_vs_truth"]);
const RATE_METRICS = new Set(["conversion", "visit", "late_delivery_rate"]);

/** Whether a number under `key` is a fraction to show as a percentage. */
export function isPercent(key: string, ctx: Context): boolean {
  if (ctx.parent && PERCENT_PARENTS.has(ctx.parent)) return true;
  const metric = typeof ctx.root.metric === "string" ? ctx.root.metric : "";
  // E-mail and store results carry their metric; for a rate metric the values are fractions too.
  if ((key.endsWith("_value") || key === "value") && RATE_METRICS.has(metric)) return true;
  if (metric === "spend" && key === "absolute_uplift") return false;
  if (key === "pct") return false;
  return PERCENT_KEY.test(key);
}

const grouped = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const twoDecimals = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
const significant = new Intl.NumberFormat("en-US", { maximumSignificantDigits: 4 });
const percent = new Intl.NumberFormat("en-US", { style: "percent", maximumFractionDigits: 2 });

export function formatNumber(value: number, key = "", ctx: Context = { root: {} }): string {
  if (!Number.isFinite(value)) return String(value);
  if (/p_value$/.test(key)) return value < 0.0001 ? "< 0.0001" : significant.format(value);
  if (isPercent(key, ctx)) return percent.format(value);
  if (key === "pct") return `${twoDecimals.format(value)}%`;
  const abs = Math.abs(value);
  if (Number.isInteger(value) || abs >= 1000) return grouped.format(value);
  if (abs >= 1) return twoDecimals.format(value);
  return significant.format(value);
}

function formatValue(value: unknown, key: string, ctx: Context): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "number") return formatNumber(value, key, ctx);
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every(isScalar)) return value.map(String).join(", ");
  return JSON.stringify(value);
}

// Comparison bars ---------------------------------------------------------------------------------

export interface Comparison {
  title: string;
  aLabel: string;
  bLabel: string;
  items: { label: string; a: number; b: number; aText: string; bText: string }[];
}

const SVG_NS = "http://www.w3.org/2000/svg";

function bar(width: number, ink: "a" | "b"): SVGRectElement {
  const rect = document.createElementNS(SVG_NS, "rect");
  rect.setAttribute("class", `bars__bar bars__bar--${ink}`);
  rect.setAttribute("x", "0");
  rect.setAttribute("y", "0");
  rect.setAttribute("width", String(Math.max(0, width)));
  rect.setAttribute("height", "10");
  return rect;
}

/** Overprinted bars: ink A and ink B share one track and multiply where they overlap. */
export function renderBars(comparison: Comparison): HTMLElement {
  const figure = el("figure", "bars");
  const caption = el("figcaption", "bars__caption");
  caption.append(el("span", "bars__title", comparison.title));
  const legend = el("span", "bars__legend");
  for (const [ink, label] of [
    ["a", comparison.aLabel],
    ["b", comparison.bLabel],
  ] as const) {
    const key = el("span", `bars__key bars__key--${ink}`);
    key.append(el("span", "bars__swatch"), label);
    legend.append(key);
  }
  caption.append(legend);
  figure.append(caption);

  const max = Math.max(...comparison.items.flatMap((item) => [item.a, item.b]), 0) || 1;
  const list = el("ul", "bars__rows");
  for (const item of comparison.items) {
    const row = el("li", "bars__row");
    row.append(el("span", "bars__label", item.label));
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "bars__track");
    svg.setAttribute("viewBox", "0 0 100 10");
    svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("aria-hidden", "true");
    svg.append(bar((item.a / max) * 100, "a"), bar((item.b / max) * 100, "b"));
    row.append(svg);
    const values = el("span", "bars__values");
    values.append(
      el("span", "bars__value bars__value--a", item.aText),
      el("span", "bars__value bars__value--b", item.bText),
    );
    // Screen readers get the comparison as words; the swatches are decoration.
    const spoken = el(
      "span",
      "visually-hidden",
      `${comparison.aLabel} ${item.aText}, ${comparison.bLabel} ${item.bText}`,
    );
    values.setAttribute("aria-hidden", "true");
    row.append(values, spoken);
    list.append(row);
  }
  figure.append(list);
  return figure;
}

const PAIR = /^control_(.+)$/;

/** control_X next to variant_X or treatment_X in one record. */
function pairsIn(record: Json): { suffix: string; a: number; b: number; bSide: string }[] {
  const pairs: { suffix: string; a: number; b: number; bSide: string }[] = [];
  for (const [key, value] of Object.entries(record)) {
    const match = PAIR.exec(key);
    if (!match || typeof value !== "number") continue;
    const suffix = match[1] as string;
    for (const side of ["variant", "treatment"]) {
      const other = record[`${side}_${suffix}`];
      if (typeof other === "number") pairs.push({ suffix, a: value, b: other, bSide: side });
    }
  }
  return pairs;
}

function rowLabel(row: Json, index: number): string {
  const named = ["segment", "key", "label", "name"].find((k) => typeof row[k] === "string");
  if (named) return String(row[named]);
  const first = Object.values(row).find((v) => typeof v === "string");
  return typeof first === "string" ? first : `Row ${index + 1}`;
}

/** Control vs variant/treatment, current plan vs this plan, and model shares vs the truth. */
export function comparisonsOf(structured: Json): Comparison[] {
  const ctx: Context = { root: structured };
  const found: Comparison[] = [];

  const top = pairsIn(structured);
  if (top.length > 0) {
    const bSide = top[0]?.bSide ?? "variant";
    found.push({
      title: "Control vs variant",
      aLabel: "Control",
      bLabel: humanize(bSide),
      items: top.map(({ suffix, a, b }) => ({
        label: humanize(suffix),
        a,
        b,
        aText: formatNumber(a, `control_${suffix}`, ctx),
        bText: formatNumber(b, `${bSide}_${suffix}`, ctx),
      })),
    });
  }

  for (const [key, value] of Object.entries(structured)) {
    if (!Array.isArray(value) || !value.every(isRecord) || value.length === 0) continue;
    const rows = value as Json[];
    const firstPairs = pairsIn(rows[0] as Json);
    const pair = firstPairs[0];
    if (!pair) continue;
    const subject = typeof structured.metric === "string" ? structured.metric : key;
    found.push({
      title: `${humanize(subject)}: control vs ${pair.bSide}`,
      aLabel: "Control",
      bLabel: humanize(pair.bSide),
      items: rows.map((row, i) => {
        const a = Number(row[`control_${pair.suffix}`] ?? 0);
        const b = Number(row[`${pair.bSide}_${pair.suffix}`] ?? 0);
        return {
          label: rowLabel(row, i),
          a,
          b,
          aText: formatNumber(a, `control_${pair.suffix}`, ctx),
          bText: formatNumber(b, `${pair.bSide}_${pair.suffix}`, ctx),
        };
      }),
    });
  }

  // Budget tools: the plan's median against the current plan's (the median minus the difference).
  const sales = structured.media_sales;
  const vs = structured.vs_current;
  if (isRecord(sales) && isRecord(vs)) {
    const plan = sales.median;
    const diff = vs.media_sales_diff_median;
    if (typeof plan === "number" && typeof diff === "number") {
      const current = plan - diff;
      found.push({
        title: "Media-driven sales, median",
        aLabel: "Current plan",
        bLabel: "This plan",
        items: [
          {
            label: "Sales",
            a: current,
            b: plan,
            aText: formatNumber(current, "median", ctx),
            bText: formatNumber(plan, "median", ctx),
          },
        ],
      });
    }
  }

  // Attribution: the true shares against the model that lands closest to them.
  const truth = structured.truth;
  const models = structured.models;
  const errors = structured.error_vs_truth;
  if (isRecord(truth) && isRecord(models) && isRecord(errors)) {
    const best = Object.entries(errors)
      .filter((entry): entry is [string, number] => typeof entry[1] === "number")
      .sort((x, y) => x[1] - y[1])[0]?.[0];
    const model = best ? models[best] : undefined;
    if (best && isRecord(model)) {
      found.push({
        title: `True shares vs the closest model (${best})`,
        aLabel: "Truth",
        bLabel: best,
        items: Object.entries(truth).map(([channel, share]) => {
          const credit = model[channel];
          const b = isRecord(credit) && typeof credit.share === "number" ? credit.share : 0;
          const a = typeof share === "number" ? share : 0;
          return {
            label: channel,
            a,
            b,
            aText: percentText(a),
            bText: percentText(b),
          };
        }),
      });
    }
  }
  return found;
}

function percentText(value: number): string {
  return percent.format(value);
}

// Tables ------------------------------------------------------------------------------------------

function scroller(table: HTMLTableElement, label: string): HTMLElement {
  // Wide tables scroll inside their own box; the box is focusable so keyboards can scroll it.
  const wrap = el("div", "result-table");
  wrap.tabIndex = 0;
  wrap.setAttribute("role", "region");
  wrap.setAttribute("aria-label", label);
  wrap.append(table);
  return wrap;
}

export function renderTable(caption: string, rows: Json[], ctx: Context): HTMLElement {
  const columns: string[] = [];
  for (const row of rows)
    for (const key of Object.keys(row)) {
      if (!columns.includes(key)) columns.push(key);
    }
  const table = el("table");
  table.append(el("caption", "", caption));
  const head = el("thead");
  const headRow = el("tr");
  for (const column of columns) {
    const th = el("th", "", humanize(column));
    th.scope = "col";
    headRow.append(th);
  }
  head.append(headRow);
  const body = el("tbody");
  for (const row of rows) {
    const tr = el("tr");
    columns.forEach((column, i) => {
      const value = row[column];
      const cell = i === 0 ? el("th") : el("td");
      if (i === 0) cell.setAttribute("scope", "row");
      cell.textContent = formatValue(value, column, ctx);
      if (typeof value === "number") cell.className = "num";
      tr.append(cell);
    });
    body.append(tr);
  }
  table.append(head, body);
  return scroller(table, caption);
}

/** A record of records of records, e.g. models -> channel -> { credit, share }: one table. */
function renderMatrix(key: string, matrix: Record<string, Json>, ctx: Context): HTMLElement {
  const columns = Object.keys(matrix);
  const rowKeys: string[] = [];
  for (const inner of Object.values(matrix))
    for (const k of Object.keys(inner)) {
      if (!rowKeys.includes(k)) rowKeys.push(k);
    }
  const rows: Json[] = rowKeys.map((rowKey) => {
    const row: Json = { [key === "models" ? "channel" : "key"]: rowKey };
    for (const column of columns) {
      const cell = matrix[column]?.[rowKey];
      row[column] = isRecord(cell)
        ? typeof cell.share === "number"
          ? cell.share
          : Object.values(cell).find((v) => typeof v === "number")
        : cell;
    }
    return row;
  });
  return renderTable(
    key === "models" ? "Share of credit by model" : humanize(key),
    rows,
    // Shares are fractions: format the whole matrix as percentages.
    { ...ctx, parent: "truth" },
  );
}

function renderRecord(key: string, record: Json, ctx: Context): HTMLElement {
  const block = el("div", "result-record");
  block.append(el("h4", "result-record__title", humanize(key)));
  const list = el("dl", "result-figures");
  for (const [k, v] of Object.entries(record)) {
    const item = el("div", "result-figures__item");
    item.append(
      el("dt", "", humanize(k)),
      el("dd", "", formatValue(v, k, { ...ctx, parent: key })),
    );
    list.append(item);
  }
  block.append(list);
  return block;
}

// The whole result --------------------------------------------------------------------------------

const SKIP = new Set(["warnings", "source"]);

export function renderResult(toolName: string, structured: Json, summary?: string): HTMLElement {
  const ctx: Context = { root: structured };
  const root = el("div", "result");
  root.dataset.tool = toolName;

  if (summary) root.append(el("p", "result__summary", summary));

  for (const comparison of comparisonsOf(structured)) root.append(renderBars(comparison));

  const figures = el("dl", "result-figures");
  const records: HTMLElement[] = [];
  const tables: HTMLElement[] = [];
  const lists: HTMLElement[] = [];

  for (const [key, value] of Object.entries(structured)) {
    if (SKIP.has(key) || value === null || value === undefined) continue;
    if (isScalar(value)) {
      const item = el("div", "result-figures__item");
      item.append(el("dt", "", humanize(key)), el("dd", "", formatValue(value, key, ctx)));
      figures.append(item);
    } else if (Array.isArray(value)) {
      if (value.length === 0) continue;
      if (value.every(isRecord)) {
        tables.push(renderTable(humanize(key), value as Json[], ctx));
      } else if (value.every(isScalar)) {
        const strings = value.map(String);
        if (strings.some((s) => s.length > 80)) {
          const details = el("details", "result-list");
          details.append(el("summary", "", humanize(key)));
          const ul = el("ul");
          for (const s of strings) ul.append(el("li", "", s));
          details.append(ul);
          lists.push(details);
        } else {
          const item = el("div", "result-figures__item");
          item.append(el("dt", "", humanize(key)), el("dd", "", strings.join(", ")));
          figures.append(item);
        }
      } else {
        tables.push(renderRecord(key, { value: JSON.stringify(value) }, ctx));
      }
    } else if (isRecord(value)) {
      const inner = Object.values(value);
      if (inner.every(isScalar)) {
        records.push(renderRecord(key, value, ctx));
      } else if (inner.every((v) => isRecord(v) && Object.values(v).every(isRecord))) {
        tables.push(renderMatrix(key, value as Record<string, Json>, ctx));
      } else {
        records.push(renderRecord(key, value, ctx));
      }
    }
  }

  if (figures.childElementCount > 0) root.append(figures);
  if (records.length > 0) {
    const group = el("div", "result-records");
    group.append(...records);
    root.append(group);
  }
  root.append(...tables, ...lists);

  const warnings = structured.warnings;
  if (Array.isArray(warnings) && warnings.length > 0) {
    const block = el("div", "result-warnings");
    block.append(el("h4", "result-warnings__title", "Warnings"));
    const ul = el("ul");
    for (const warning of warnings) ul.append(el("li", "", String(warning)));
    block.append(ul);
    root.append(block);
  }

  if (typeof structured.source === "string") {
    const source = el("p", "result__source");
    source.append(el("span", "result__source-label", "Source: "), structured.source);
    root.append(source);
  }

  const raw = el("details", "result-raw");
  raw.append(el("summary", "", "Raw JSON"));
  raw.append(el("pre", "result-raw__json", JSON.stringify(structured, null, 2)));
  root.append(raw);
  return root;
}
