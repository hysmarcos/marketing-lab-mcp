import { z } from "zod";
import journeys from "../../../data/journeys_sample.json";
import {
  type AttributionData,
  type AttributionResult,
  compareAttribution,
  MAX_CHANNEL_NAME,
  MAX_CHANNELS,
  MAX_JOURNEYS,
  MAX_PATH_LENGTH,
  MODELS,
} from "../../core/attribution";
import { fitSummary, groupDigits } from "../summary";
import type { ToolSpec } from "../tool";

const data = journeys as AttributionData;

const journey = z.strictObject({
  path: z
    .array(z.string())
    .min(1)
    .max(MAX_PATH_LENGTH)
    .describe(
      `Channels the users touched, in order, 1 to ${MAX_PATH_LENGTH} touches. Channel names are free text of 1 to ${MAX_CHANNEL_NAME} characters; spaces around a name are ignored and case matters ("Email" and "email" are two channels). Repeats are allowed.`,
    ),
  conversions: z
    .number()
    .int()
    .min(0)
    .max(1e9)
    .describe("How many users who followed exactly this path converted. Whole number, 0 or more."),
  nulls: z
    .number()
    .int()
    .min(0)
    .max(1e9)
    .describe(
      "How many users who followed exactly this path did not convert. Whole number, 0 or more.",
    ),
});

const input = z.strictObject({
  journeys: z
    .array(journey)
    .min(1)
    .max(MAX_JOURNEYS)
    .optional()
    .describe(
      `Your own journeys, 1 to ${MAX_JOURNEYS} rows, one row per distinct path with its conversions and nulls (non-converting users). Up to ${MAX_CHANNELS} distinct channels. When given, the simulated sample is not used and there is no ground truth, so the result has no error_vs_truth. Leave out to run on the simulated sample.`,
    ),
});

function points(share: number): string {
  return `${(share * 100).toFixed(1)}%`;
}

const LABEL: Record<(typeof MODELS)[number], string> = {
  last_touch: "last",
  first_touch: "first",
  linear: "linear",
  markov: "markov",
  shapley: "shapley",
};

function summarize(out: AttributionResult): string {
  const simulated = out.truth !== null && out.error_vs_truth !== null;
  const head = [
    simulated
      ? `Attribution models on SIMULATED journeys (seed 42, known ground truth): ${groupDigits(out.total_conversions)} conversions over ${out.channels.length} channels. Each cell is the share of conversions credited to the channel.`
      : `Attribution models on your journeys: ${groupDigits(out.total_conversions)} conversions over ${out.channels.length} channels. Each cell is the share of conversions credited to the channel.`,
  ];
  if (out.error_vs_truth) {
    const errors = MODELS.map(
      (m) => `${LABEL[m]} ${((out.error_vs_truth?.[m] ?? 0) * 100).toFixed(1)}`,
    );
    head.push(
      `Mean absolute error of the shares vs the true counterfactual shares, in percentage points (lower is better): ${errors.join(", ")}.`,
    );
  }
  const details = out.channels.map((c) => {
    const cells = MODELS.map((m) => `${LABEL[m]} ${points(out.models[m][c]?.share ?? 0)}`);
    const truth = out.truth ? `truth ${points(out.truth[c] ?? 0)} | ` : "";
    return `${c}: ${truth}${cells.join(", ")}`;
  });
  return fitSummary(head, details, out.warnings);
}

export const attributionCompare: ToolSpec<typeof input, AttributionResult> = {
  name: "attribution_compare",
  title: "Attribution model comparison",
  description:
    `Use to see how much credit each marketing channel gets under five attribution models, and how far they disagree. The models: last_touch (all credit to the last channel before converting), first_touch (all credit to the first), linear (equal split over every touch, repeats included), markov (data-driven: a first-order Markov chain over channels; each channel's credit follows its removal effect, the drop in conversion probability when its node is sent to a dead end), and shapley (exact Shapley values from the cooperative game where a set of channels is worth the conversions of journeys that used only those channels). Each model returns credit (conversions) and share per channel; credits add up to total conversions. ` +
    `With no arguments it runs on a SIMULATED sample (seed 42, 20,000 users, 6 channels: display, paid_social, paid_search, email, organic_search, direct) generated with a known ground truth, the true share of each channel from a counterfactual removal (how much conversion probability is lost if the channel is taken out of everyone's path). So the result also includes truth and error_vs_truth, the mean absolute error of each model's shares, which shows which model recovers the real contribution; that sample is not real data, and its truth depends on the assumptions of the simulator. ` +
    `To use your own data, pass journeys: 1 to ${MAX_JOURNEYS} rows of {path, conversions, nulls}, one row per distinct path (channels in order, 1 to ${MAX_PATH_LENGTH} touches; nulls are the users on that path who did not convert), with at most ${MAX_CHANNELS} distinct channels. Channel names are free text, trimmed, case-sensitive. Your own data has no ground truth, so truth and error_vs_truth are null. Models describe credit assignment, not causal lift: only an experiment proves incrementality.`,
  input,
  run: (args) => compareAttribution(args, data),
  summarize,
  examples: [
    { label: "Simulated sample with known truth", args: {} },
    {
      label: "Compare models on three of my own paths",
      args: {
        journeys: [
          { path: ["paid_social", "email"], conversions: 40, nulls: 360 },
          { path: ["paid_search"], conversions: 55, nulls: 445 },
          { path: ["paid_social", "paid_search", "email"], conversions: 30, nulls: 170 },
          { path: ["email"], conversions: 12, nulls: 388 },
        ],
      },
    },
  ],
};
