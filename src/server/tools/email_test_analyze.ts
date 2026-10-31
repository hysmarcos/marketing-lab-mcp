import { z } from "zod";
import hillstrom from "../../../data/hillstrom_cells.json";
import {
  analyzeEmailTest,
  type EmailData,
  type EmailMetric,
  type EmailRow,
  type EmailTestResult,
} from "../../core/email";
import { MAX_SUMMARY_LENGTH, type ToolSpec } from "../tool";

const data = hillstrom as EmailData;

const input = z.strictObject({
  campaign: z
    .enum(["mens", "womens"])
    .optional()
    .describe(
      "Which e-mail to compare against the control group that received no e-mail: 'mens' (men's merchandise e-mail) or 'womens' (women's merchandise e-mail). Default 'mens'.",
    ),
  metric: z
    .enum(["visit", "conversion", "spend"])
    .optional()
    .describe(
      "Outcome measured in the two weeks after the send: 'visit' (visited the website), 'conversion' (bought something) or 'spend' (dollars spent per recipient). Default 'conversion'.",
    ),
  segment_by: z
    .enum(["history_segment", "zip_code", "channel", "newbie", "mens", "womens"])
    .optional()
    .describe(
      "Optional customer attribute to split the result by: 'history_segment' (past-year spend bucket), 'zip_code' (Rural, Suburban, Urban), 'channel' (Phone, Web, Multichannel), 'newbie' (new or existing customer), 'mens' or 'womens' (bought men's or women's merchandise before). Omit for one overall row.",
    ),
});

const METRIC_LABEL: Record<EmailMetric, string> = {
  visit: "visit rate",
  conversion: "conversion rate",
  spend: "spend per recipient",
};

function format(metric: EmailMetric, value: number): string {
  return metric === "spend" ? `$${value.toFixed(2)}` : `${(value * 100).toFixed(2)}%`;
}

function formatP(p: number): string {
  return p < 0.001 ? p.toExponential(1) : p.toPrecision(2);
}

function describeRow(metric: EmailMetric, r: EmailRow): string {
  const relative =
    r.relative_uplift === null
      ? "relative uplift undefined"
      : `${r.relative_uplift >= 0 ? "+" : ""}${(r.relative_uplift * 100).toFixed(1)}% relative`;
  const verdict = r.significant ? "significant" : "not significant";
  return `${r.segment}: ${format(metric, r.control_value)} -> ${format(metric, r.treatment_value)} (${relative}, p ${formatP(r.p_value)}, ${verdict}, n ${r.n_control}/${r.n_treatment})`;
}

function summarize(out: EmailTestResult): string {
  const lines = [
    `${out.campaign} e-mail vs no e-mail, ${METRIC_LABEL[out.metric]} (control -> e-mail), significance at 5%:`,
    ...out.rows.map((r) => describeRow(out.metric, r)),
  ];
  const significant = out.rows.filter((r) => r.significant).length;
  if (out.rows.length > 1) {
    lines.push(`${significant} of ${out.rows.length} segments are significant.`);
  }
  // Keep whole warnings only; the full list is always in the structured output.
  const room = MAX_SUMMARY_LENGTH - 60;
  let used = lines.join("\n").length + "\nWarnings:".length;
  const kept: string[] = [];
  for (const w of out.warnings) {
    if (used + 1 + w.length > room) break;
    kept.push(w);
    used += 1 + w.length;
  }
  if (kept.length > 0) lines.push(`Warnings: ${kept.join(" ")}`);
  const dropped = out.warnings.length - kept.length;
  if (dropped > 0) lines.push(`(${dropped} more warning(s) in the structured output.)`);
  return lines.join("\n");
}

export const emailTestAnalyze: ToolSpec<typeof input, EmailTestResult> = {
  name: "email_test_analyze",
  title: "E-mail test analyzer",
  description:
    "Use to see whether an e-mail campaign changed customer behavior and for which customers, using the real Hillstrom e-mail experiment (64,000 customers randomly split into men's e-mail, women's e-mail and no e-mail; outcomes measured over the following two weeks). Compares one campaign with the no-e-mail control on visit rate, conversion rate or spend per recipient, overall or split by one customer attribute. For each row it returns control and e-mail values, the absolute and relative uplift, a two-sided p-value (z-test for rates, Welch t-test for spend), a significant flag at 5%, and group sizes. P-values are not corrected for the number of segments. Data is a fixed aggregated public summary; nothing is read from the request except the options.",
  input,
  run: (args) => analyzeEmailTest(data, args),
  summarize,
  examples: [
    { label: "Men's e-mail, overall conversion", args: { campaign: "mens", metric: "conversion" } },
    {
      label: "Women's e-mail, spend by customer channel",
      args: { campaign: "womens", metric: "spend", segment_by: "channel" },
    },
    {
      label: "Men's e-mail, conversion by zip code",
      args: { campaign: "mens", metric: "conversion", segment_by: "zip_code" },
    },
  ],
};
