import { z } from "zod";
import data from "../../../data/mmm_results.json";
import { type MmmResults, money, type SimulateResult, simulateBudget } from "../../core/budget";
import { MAX_SUMMARY_LENGTH, type ToolSpec } from "../tool";
import { channelAmounts } from "./budget_schema";

const results = data as unknown as MmmResults;

const input = z.strictObject({
  weekly_spend: channelAmounts("Planned spend")
    .optional()
    .describe(
      "Planned spend per week for the channels you want to change, in dollars. A channel you leave out keeps its current weekly spend (about $41,100 per week across all five), so you can ask for one change at a time. Omit the whole field to simulate the current plan. The spend is held constant every week of the 13-week horizon.",
    ),
});

function summarize(out: SimulateResult): string {
  const spend = Object.entries(out.weekly_spend)
    .map(([c, v]) => `${c} ${money(v)}`)
    .join(", ");
  const { media_sales: m, vs_current: d } = out;
  const sign = d.media_sales_diff_median >= 0 ? "+" : "-";
  const lines = [
    `Weekly spend: ${spend}.`,
    `Media-driven sales over ${out.horizon_weeks} weeks: median ${money(m.median)} (90% band ${money(m.p05)} to ${money(m.p95)}).`,
    `Versus the current plan: ${sign}${money(Math.abs(d.media_sales_diff_median))} (${sign}${Math.abs(d.pct).toFixed(1)}%) on the median.`,
  ];
  for (const w of out.warnings) {
    if (lines.join("\n").length + w.length + 1 > MAX_SUMMARY_LENGTH - 80) break;
    lines.push(w);
  }
  return lines.join("\n");
}

export const budgetSimulate: ToolSpec<typeof input, SimulateResult> = {
  name: "budget_simulate",
  title: "Budget simulator",
  description:
    "Use to estimate how much media-driven sales a weekly marketing budget would produce, and how that compares with the current plan. Reads a Bayesian marketing mix model (PyMC-Marketing) fitted on Meta Robyn's simulated demo dataset, so the channels are tv, ooh (out-of-home), print, facebook and search, and the numbers describe that demo business, not yours. You give a constant weekly spend per channel (channels you leave out keep their current spend); it returns media-driven sales summed over a 13-week horizon as a median with a 90% band (5th to 95th percentile of 200 posterior draws), the difference against the current plan (vs_current.media_sales_diff_median is the plan's median minus the current plan's median, not a median of paired differences; vs_current.pct is a percentage, so 33.2 means +33.2%), and which channels are above the highest weekly spend ever seen (the model is extrapolating there, so treat those results with caution). The effect of spend from the weeks before the horizon is included. All dollar values are in the demo dataset's simulated dollars; this is an illustration of the method, not advice for a real budget. The model data is a fixed snapshot.",
  input,
  run: (args) => simulateBudget(results, args),
  summarize,
  examples: [
    { label: "Current plan", args: {} },
    {
      label: "Move budget from TV to search",
      args: { weekly_spend: { tv: 4000, search: 18000 } },
    },
    {
      label: "Double facebook, keep the rest",
      args: { weekly_spend: { facebook: 7000 } },
    },
  ],
};
