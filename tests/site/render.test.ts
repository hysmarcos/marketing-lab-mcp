// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { comparisonsOf, formatNumber, renderResult } from "../../site/src/render";
import { TOOLS } from "../../src/server/tools";

function run(name: string, index = 0): Record<string, unknown> {
  const spec = TOOLS.find((t) => t.name === name);
  const example = spec?.examples[index];
  if (!spec || !example) throw new Error(`no example ${index} for ${name}`);
  return JSON.parse(JSON.stringify(spec.run(example.args)));
}

describe("renderResult", () => {
  it.each(TOOLS.flatMap((spec) => spec.examples.map((_e, i) => [spec.name, i] as const)))(
    "renders %s example %i with the raw JSON in a details element",
    (name, index) => {
      const structured = run(name, index);
      const node = renderResult(name, structured, "Summary.");
      expect(node.querySelector(".result__summary")?.textContent).toBe("Summary.");
      const raw = node.querySelector("details.result-raw pre");
      expect(JSON.parse(raw?.textContent ?? "")).toEqual(structured);
    },
  );

  it("puts rows and segments in tables", () => {
    const sales = renderResult("store_sales", run("store_sales"));
    const table = sales.querySelector(".result-table table");
    expect(table?.querySelector("caption")?.textContent).toBe("Rows");
    expect(table?.querySelectorAll("tbody tr")).toHaveLength(10);
    expect(table?.querySelector("tbody th")?.textContent).toBe("health_beauty");

    const rfm = renderResult("customer_rfm", run("customer_rfm"));
    expect(rfm.querySelector(".result-table caption")?.textContent).toBe("Segments");
    // Shares print as percentages.
    expect(rfm.textContent).toContain("1.29%");
  });

  it("draws control vs variant bars in ink A and ink B", () => {
    const node = renderResult("ab_test_evaluate", run("ab_test_evaluate"));
    const bars = node.querySelector(".bars");
    expect(bars).not.toBeNull();
    expect(bars?.querySelector(".bars__bar--a")).not.toBeNull();
    expect(bars?.querySelector(".bars__bar--b")).not.toBeNull();
    expect(bars?.querySelector(".bars__values")?.textContent).toBe("5.68%6.32%");
  });

  it("compares the budget plan with the current plan, and the model with the truth", () => {
    const optimize = comparisonsOf(run("budget_optimize"));
    expect(optimize.map((c) => [c.aLabel, c.bLabel])).toEqual([["Current plan", "This plan"]]);
    const attribution = comparisonsOf(run("attribution_compare"));
    expect(attribution[0]?.aLabel).toBe("Truth");
    expect(attribution[0]?.bLabel).toBe("first_touch");
    expect(attribution[0]?.items).toHaveLength(6);
    // Own journeys have no truth, so no comparison.
    expect(comparisonsOf(run("attribution_compare", 1))).toEqual([]);
    const email = comparisonsOf(run("email_test_analyze", 2));
    expect(email[0]?.title).toBe("Conversion: control vs treatment");
    expect(email[0]?.items.map((i) => i.label)).toEqual(["Rural", "Suburban", "Urban"]);
  });

  it("lists warnings", () => {
    const node = renderResult("store_sales", run("store_sales"));
    expect(node.querySelectorAll(".result-warnings li")).toHaveLength(1);
  });

  it("prints strings from the input as text, never as markup", () => {
    const evil = '<img src=x onerror="window.pwned=1">';
    const node = renderResult("store_sales", {
      group_by: "category",
      rows: [{ key: evil, value: 1 }],
      warnings: [evil],
      source: evil,
    });
    expect(node.querySelector("img")).toBeNull();
    expect(node.textContent).toContain(evil);
  });
});

describe("formatNumber", () => {
  it("formats rates, p-values and large numbers", () => {
    const ctx = { root: {} };
    expect(formatNumber(0.0568, "control_rate", ctx)).toBe("5.68%");
    expect(formatNumber(1.5e-13, "p_value", ctx)).toBe("< 0.0001");
    expect(formatNumber(3486914.42, "median", ctx)).toBe("3,486,914");
    expect(formatNumber(13914, "per_variant", ctx)).toBe("13,914");
    expect(formatNumber(33.2224, "pct", ctx)).toBe("+33.22");
  });

  it("shows differences between rates in percentage points", () => {
    const ctx = { root: {} };
    expect(formatNumber(0.006424, "absolute_diff", ctx)).toBe("0.64 pp");
    expect(formatNumber(0.0019, "ci_low", ctx)).toBe("0.19 pp");
    expect(formatNumber(0.0518, "first_touch", { root: {}, parent: "error_vs_truth" })).toBe(
      "5.18 pp",
    );
    const email = { root: { metric: "conversion" } };
    expect(formatNumber(0.0068, "absolute_uplift", email)).toBe("0.68 pp");
    // For spend the uplift is money per recipient, not a rate.
    expect(formatNumber(0.77, "absolute_uplift", { root: { metric: "spend" } })).toBe("0.77");
  });
});

describe("labels", () => {
  it("names the change against the current plan and puts dollars on budget figures", () => {
    const node = renderResult("budget_optimize", run("budget_optimize"));
    const labels = [...node.querySelectorAll("dt, .result-record__title")].map(
      (n) => n.textContent,
    );
    expect(labels).toContain("Change vs current (%)");
    expect(labels).toContain("Allocation ($)");
    expect(labels).toContain("Media sales ($)");
    expect(labels).toContain("Total weekly ($)");
    expect(node.querySelector(".bars__title")?.textContent).toBe("Media-driven sales, median ($)");
  });

  it("puts reais on Olist revenue", () => {
    const node = renderResult("store_sales", run("store_sales"));
    const headers = [...node.querySelectorAll("thead th")].map((n) => n.textContent);
    expect(headers).toEqual(["Key", "Value (R$)", "Orders", "Revenue (R$)"]);
    const orders = renderResult("store_sales", run("store_sales", 1));
    expect([...orders.querySelectorAll("thead th")].map((n) => n.textContent)).toContain("Value");
  });
});
