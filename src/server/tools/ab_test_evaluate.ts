import { z } from "zod";
import { type AbTestResult, evaluateAbTest } from "../../core/abtest";
import type { ToolSpec } from "../tool";

const arm = (who: string) =>
  z
    .strictObject({
      visitors: z
        .number()
        .int()
        .min(1)
        .max(1e10)
        .describe(`Number of visitors (or sessions, or recipients) exposed to the ${who}.`),
      conversions: z
        .number()
        .int()
        .min(0)
        .max(1e10)
        .describe(`Number of those ${who} visitors who converted. Cannot exceed visitors.`),
    })
    .describe(`Results for the ${who} arm.`);

const input = z.strictObject({
  control: arm("control"),
  variant: arm("variant"),
  confidence: z
    .number()
    .min(0.8)
    .max(0.99)
    .optional()
    .describe("Confidence level for the interval and the significance call. Default 0.95."),
  expected_split: z
    .number()
    .min(0.01)
    .max(0.99)
    .optional()
    .describe(
      "Share of traffic that was supposed to go to the control, used for the sample ratio check. Default 0.5.",
    ),
});

const pct = (x: number, digits = 2) => `${(x * 100).toFixed(digits)}%`;

function summarize(r: AbTestResult): string {
  const lift =
    r.relative_lift === null
      ? "The relative lift is undefined because the control rate is 0."
      : `Relative lift: ${r.relative_lift >= 0 ? "+" : ""}${pct(r.relative_lift, 1)}.`;
  const verdict = r.significant
    ? "The difference is statistically significant."
    : "The difference is not statistically significant.";
  const lines = [
    `Control converts at ${pct(r.control_rate)}, variant at ${pct(r.variant_rate)} (difference ${(r.absolute_diff * 100).toFixed(3)} percentage points). ${lift}`,
    `${verdict} p-value ${r.p_value.toPrecision(3)}; confidence interval for the difference [${pct(r.ci_low, 3)}, ${pct(r.ci_high, 3)}].`,
    `Probability that the variant beats the control: ${pct(r.prob_variant_better, 1)}.`,
    r.srm_detected
      ? `Sample ratio mismatch detected (p = ${r.srm_p_value.toExponential(2)}): do not trust the result until the traffic split is checked.`
      : `No sample ratio mismatch (p = ${r.srm_p_value.toPrecision(3)}).`,
  ];
  if (r.warnings.length > 0) lines.push(`Warnings: ${r.warnings.join(" ")}`);
  return lines.join("\n");
}

export const abTestEvaluate: ToolSpec<typeof input, AbTestResult> = {
  name: "ab_test_evaluate",
  title: "A/B test evaluator",
  description:
    "Use when the user has visitors and conversions for a control and a variant and wants to know if the variant really won. Returns both conversion rates, the absolute and relative lift, a two-sided z-test p-value, a confidence interval for the difference, the Bayesian probability that the variant is better, and a sample ratio mismatch check that flags broken traffic splits (pass expected_split when the arms were not meant to be equal). Also use it on the overall counts of any experiment analysed with another tool (for example the e-mail test) to confirm the split and get the probability that the variant is better. Works from counts only; no data leaves the request.",
  input,
  run: (args) => evaluateAbTest(args),
  summarize,
  examples: [
    {
      label: "Hillstrom-sized email test",
      args: {
        control: { visitors: 21306, conversions: 1210 },
        variant: { visitors: 21387, conversions: 1352 },
      },
    },
    {
      label: "Clear win on 10,000 visitors per arm",
      args: {
        control: { visitors: 10000, conversions: 500 },
        variant: { visitors: 10000, conversions: 570 },
      },
    },
  ],
};
