import { z } from "zod";
import funnel from "../../../data/olist_funnel.json";
import { type FunnelData, type FunnelResult, queryFunnel } from "../../core/funnel";
import { fitSummary, groupDigits } from "../summary";
import type { ToolSpec } from "../tool";

const data = funnel as FunnelData;

const monthField = (what: string) =>
  z
    .string()
    .regex(/^\d{4}-\d{2}$/)
    .optional()
    .describe(
      `${what} first-contact month to include, as YYYY-MM (for example 2018-01). Leads in the data first made contact in 2017-06 to 2018-05.`,
    );

const input = z.strictObject({
  group_by: z
    .enum(["origin", "business_segment", "month"])
    .optional()
    .describe(
      "How to split the funnel: 'origin' (the channel the lead came from, such as organic_search, paid_search, social, direct_traffic, email, referral, display, other_publicities, other or unknown), 'business_segment' (the seller's line of business such as home_decor or health_beauty; known only for closed deals, so lead counts are null) or 'month' (first-contact month). Default 'origin'.",
    ),
  origin: z
    .string()
    .max(40)
    .optional()
    .describe(
      "Only count leads from this origin, for example paid_search or organic_search. Case and spaces do not matter. An unknown name returns no rows and lists the valid origins.",
    ),
  from_month: monthField("First"),
  to_month: monthField("Last"),
});

function percent(rate: number | null): string {
  return rate === null ? "n/a" : `${(rate * 100).toFixed(1)}%`;
}

function summarize(out: FunnelResult): string {
  if (out.rows.length === 0) {
    const [first = ""] = out.warnings;
    const trimmed = first.length > 700 ? `${first.slice(0, 697)}...` : first;
    return trimmed ? `No rows matched the filters. ${trimmed}` : "No rows matched the filters.";
  }
  const head = [
    `Olist seller-acquisition funnel by ${out.group_by.replace("_", " ")} (data: leads first contacted 2017-06 to 2018-05). In scope: ${groupDigits(out.totals.mqls)} MQLs (marketing-qualified leads), ${groupDigits(out.totals.deals)} closed deals, ${percent(out.totals.conversion_rate)} conversion.`,
  ];
  if (out.group_by === "business_segment") {
    head.push("A lead has no segment until it closes, so only deals are split by segment.");
  }
  const details = out.rows.map((r) => {
    const leads = r.mqls === null ? "" : `${groupDigits(r.mqls)} MQLs, `;
    const conversion = r.conversion_rate === null ? "" : ` (${percent(r.conversion_rate)})`;
    const days =
      r.median_days_to_close === null
        ? "no deals"
        : `median ${r.median_days_to_close} days to close`;
    return `${r.key}: ${leads}${groupDigits(r.deals)} deals${conversion}, ${days}`;
  });
  return fitSummary(head, details, out.warnings);
}

export const leadFunnel: ToolSpec<typeof input, FunnelResult> = {
  name: "lead_funnel",
  title: "Lead funnel by channel",
  description:
    "Use to see which marketing channels bring leads that actually close, in a B2B funnel. Reads a fixed aggregate of the Olist Marketing Funnel public dataset: 8,000 marketing-qualified leads (MQLs, businesses that asked to sell on the Olist marketplace) first contacted between 2017-06 and 2018-05, and the 842 that became closed deals (new sellers). Group by origin (the channel the lead came from: organic_search, paid_search, social, direct_traffic, email, referral, display, other_publicities, other, unknown), by month of first contact, or by business_segment (the seller's line of business; only known for closed deals, so MQL counts and conversion are null there). Optionally filter to one origin and a month range (applied to the contact month). Each row has MQLs, deals, conversion rate (deals divided by MQLs) and the median days from first contact to won date; rows are sorted by deals (months in date order). Conversion is a snapshot at the end of the data, so recent months look worse because those leads had less time to close. One deal in the source closed before its recorded first contact (negative days); it is kept and flagged. This is a historical dataset, not your funnel.",
  input,
  run: (args) => queryFunnel(data, args),
  summarize,
  examples: [
    { label: "Conversion by origin", args: {} },
    { label: "Deals by business segment", args: { group_by: "business_segment" } },
    {
      label: "Paid search by month in 2018",
      args: { group_by: "month", origin: "paid_search", from_month: "2018-01" },
    },
  ],
};
