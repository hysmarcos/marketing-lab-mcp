import { z } from "zod";
import data from "../../../data/mmm_results.json";
import { type MmmResults, money, type OptimizeResult, optimizeBudget } from "../../core/budget";
import { MAX_SUMMARY_LENGTH, type ToolSpec } from "../tool";

const results = data as unknown as MmmResults;

const input = z.strictObject({
  total_weekly: z
    .number()
    .positive()
    .optional()
    .describe(
      "Total budget to split across the five channels, in dollars per week. Default: the current weekly total (about $41,100). Must be at most 5 times the current total.",
    ),
  min: z
    .record(z.string(), z.number())
    .optional()
    .describe(
      "Lowest weekly spend, in dollars, to force on a channel, e.g. {\"search\": 8000}. Keys are 'tv', 'ooh', 'print', 'facebook', 'search' ('tv_S' style also works). Channels you leave out have a minimum of 0.",
    ),
  max: z
    .record(z.string(), z.number())
    .optional()
    .describe(
      "Highest weekly spend, in dollars, to allow on a channel, e.g. {\"tv\": 5000}. Keys are 'tv', 'ooh', 'print', 'facebook', 'search' ('tv_S' style also works). Channels you leave out are capped at 1.5 times the highest weekly spend seen in the data.",
    ),
});

function summarize(out: OptimizeResult): string {
  const alloc = Object.entries(out.allocation)
    .map(([c, v]) => `${c} ${money(v)}`)
    .join(", ");
  const { media_sales: m, vs_current: d } = out;
  const sign = d.media_sales_diff_median >= 0 ? "+" : "-";
  const lines = [
    `Best split of ${money(out.total_weekly)} per week: ${alloc}.`,
    `Media-driven sales over ${out.horizon_weeks} weeks: median ${money(m.median)} (90% band ${money(m.p05)} to ${money(m.p95)}).`,
    `Versus the current plan: ${sign}${money(Math.abs(d.media_sales_diff_median))} (${sign}${Math.abs(d.pct).toFixed(1)}%) on the median.`,
    "The split is optimized on the average of the model's draws; the band shows the uncertainty.",
  ];
  for (const w of out.warnings) {
    if (lines.join("\n").length + w.length + 1 > MAX_SUMMARY_LENGTH - 80) break;
    lines.push(w);
  }
  return lines.join("\n");
}

export const budgetOptimize: ToolSpec<typeof input, OptimizeResult> = {
  name: "budget_optimize",
  title: "Budget optimizer",
  description:
    "Use to find how to split a weekly marketing budget across channels to get the most media-driven sales. Reads a Bayesian marketing mix model (PyMC-Marketing) fitted on Meta Robyn's simulated demo dataset, so the channels are tv, ooh (out-of-home), print, facebook and search, and the numbers describe that demo business, not yours. It spreads the total in 200 small steps, each to the channel with the biggest expected gain at that point (saturation and carry-over from earlier weeks included), within optional per-channel minimums and maximums. It returns the weekly dollars per channel, the media-driven sales over a 13-week horizon as a median with a 90% band (200 posterior draws), and the gain over the current plan. The default total is the current weekly spend. Allocations the model cannot support are flagged: a channel above the highest weekly spend seen in the data means the model is extrapolating. The optimum is approximate and the data is a fixed snapshot; this illustrates the method, not advice for a real budget.",
  input,
  run: (args) => optimizeBudget(results, args),
  summarize,
  examples: [
    { label: "Reallocate the current budget", args: {} },
    {
      label: "Smaller budget with a search floor",
      args: { total_weekly: 30000, min: { search: 8000 } },
    },
    {
      label: "Cap TV and Facebook",
      args: { max: { tv: 5000, facebook: 8000 } },
    },
  ],
};
