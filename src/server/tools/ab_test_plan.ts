import { z } from "zod";
import { type AbTestPlan, planAbTest } from "../../core/abtest";
import type { ToolSpec } from "../tool";

const input = z.strictObject({
  baseline_rate: z
    .number()
    .gt(0)
    .lt(1)
    .describe("Current conversion rate of the control as a fraction, e.g. 0.03 for 3%."),
  mde_relative: z
    .number()
    .min(0.001)
    .max(10)
    .describe(
      "Smallest relative improvement worth detecting, e.g. 0.2 for a 20% lift over the baseline (3% to 3.6%). At least 0.001.",
    ),
  alpha: z
    .number()
    .gt(0)
    .lt(0.5)
    .optional()
    .describe("Significance level (false-positive rate), two-sided. Default 0.05."),
  power: z
    .number()
    .gt(0)
    .lt(1)
    .optional()
    .describe("Probability of detecting the effect if it is real. Default 0.8."),
  variants: z
    .number()
    .int()
    .min(2)
    .max(5)
    .optional()
    .describe(
      "Total arms including the control. Default 2. With more, alpha is Bonferroni-corrected.",
    ),
  daily_visitors: z
    .number()
    .gt(0)
    .max(1e9)
    .optional()
    .describe("Total visitors per day entering the test, to estimate duration. Optional."),
});

function summarize(p: AbTestPlan): string {
  const lines = [
    `You need about ${p.per_variant.toLocaleString("en-US")} visitors per variant, ${p.total.toLocaleString("en-US")} in total.`,
  ];
  if (p.days !== null) lines.push(`At the given traffic that takes about ${p.days} days.`);
  if (p.warnings.length > 0) lines.push(`Warnings: ${p.warnings.join(" ")}`);
  return lines.join("\n");
}

export const abTestPlan: ToolSpec<typeof input, AbTestPlan> = {
  name: "ab_test_plan",
  title: "A/B test sample size planner",
  description:
    "Use before launching an A/B test to find out how many visitors it needs and how long it will run. Given the baseline conversion rate and the smallest relative lift worth detecting, returns the sample size per variant, the total, and the duration in days when daily traffic is given. Uses the two-proportion normal-approximation formula; adds a Bonferroni correction when there are more than two arms.",
  input,
  run: (args) => planAbTest(args),
  summarize,
  examples: [
    {
      label: "3% baseline, 20% lift, 2,000 visitors a day",
      args: { baseline_rate: 0.03, mde_relative: 0.2, daily_visitors: 2000 },
    },
  ],
};
