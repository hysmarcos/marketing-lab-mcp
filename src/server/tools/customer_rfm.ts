import { z } from "zod";
import rfm from "../../../data/olist_rfm.json";
import { queryRfm, type RfmData, type RfmResult, SEGMENTS } from "../../core/rfm";
import { brl, fitSummary, groupDigits } from "../summary";
import type { ToolSpec } from "../tool";

const data = rfm as RfmData;

const customer = z.strictObject({
  customer_id: z
    .string()
    .min(1)
    .max(64)
    .describe("Your own identifier for the customer. Each id may appear only once."),
  last_order_date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .describe("Date of the customer's most recent order, as YYYY-MM-DD."),
  orders: z
    .number()
    .int()
    .min(1)
    .max(100000)
    .describe("Number of orders the customer has placed, at least 1."),
  revenue: z
    .number()
    .min(0)
    .max(1e12)
    .describe("Total money the customer has spent, in any one currency, 0 or more."),
});

const input = z.strictObject({
  state: z
    .string()
    .max(40)
    .optional()
    .describe(
      "Olist data only: restrict to customers whose latest order shipped to this Brazilian state, as a 2-letter code such as SP, RJ, MG, RS or BA. Case does not matter. An unknown code returns no segments and lists the valid codes. Not allowed together with customers.",
    ),
  segment: z
    .enum(SEGMENTS)
    .optional()
    .describe(
      "Only return this segment: champions, loyal, big_spenders_new, recent, needs_attention, at_risk_high_value or hibernating. Shares stay relative to all customers in scope.",
    ),
  customers: z
    .array(customer)
    .min(1)
    .max(5000)
    .optional()
    .describe(
      "Your own customers, 1 to 5000, each with customer_id, last_order_date (YYYY-MM-DD), orders and revenue. When given, they are scored and segmented with the same rules inside your list and the Olist data is not used.",
    ),
  as_of: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .describe(
      "Only with customers: the date recency is measured to, as YYYY-MM-DD, on or after every last_order_date. Default: the day after the latest last_order_date in your list.",
    ),
});

function summarize(out: RfmResult): string {
  if (out.segments.length === 0) {
    const [first = ""] = out.warnings;
    const trimmed = first.length > 700 ? `${first.slice(0, 697)}...` : first;
    return trimmed ? `No segments to show. ${trimmed}` : "No segments to show.";
  }
  const olist = out.mode === "olist";
  const money = (n: number) => (olist ? brl(n) : groupDigits(n));
  const noun = (n: number) => (n === 1 ? "customer" : "customers");
  const head = [
    `${olist ? "Olist customers, RFM as of 2018-09-01, money in BRL" : `Your customers, RFM as of ${out.as_of}`}: ${groupDigits(out.total_customers)} ${noun(out.total_customers)} in scope, ${out.segments.length} segment(s) shown. Recency is days since the last order.`,
  ];
  const details = out.segments.map(
    (s) =>
      `${s.segment}: ${groupDigits(s.customers)} ${noun(s.customers)} (${(s.share * 100).toFixed(1)}%), revenue ${money(s.revenue)}, avg recency ${s.avg_recency_days.toFixed(0)} days, ${s.avg_orders.toFixed(2)} orders, ${money(s.avg_monetary)} per customer`,
  );
  return fitSummary(head, details, out.warnings);
}

export const customerRfm: ToolSpec<typeof input, RfmResult> = {
  name: "customer_rfm",
  title: "Customer RFM segments",
  description:
    "Use to split customers into RFM segments (how Recently they bought, how Frequently, how much Money they spent) and see how big and valuable each segment is. Two modes. Without customers, it reads a fixed aggregate of the Olist public e-commerce dataset (Brazilian marketplace, 93,358 customers with delivered orders before 2018-09-01, money in Brazilian reais, BRL), optionally filtered to one Brazilian state (2-letter code such as SP or RJ) or one segment. With customers (1 to 5000, each with id, last_order_date, orders, revenue), it scores your list with the same rules and nothing is stored. Scores: R and M are quintiles from 1 to 5 (5 = most recent, highest spend; ties ranked in input order), F is 1 for one order, 3 for two, 5 for three or more. Segments, first match wins: champions, loyal, big_spenders_new, recent, needs_attention, at_risk_high_value, hibernating. Returns for each segment the customer count, share, revenue, average recency in days, average orders and average spend, plus the rules used. In Olist data, a frequency score of 3 means two orders, so loyal and champions need only two orders. With fewer than 5 of your own customers the quintiles are not meaningful.",
  input,
  run: (args) => queryRfm(data, args),
  summarize,
  examples: [
    { label: "All Olist customers", args: {} },
    { label: "Olist customers in Sao Paulo (SP)", args: { state: "SP" } },
    {
      label: "Score my own eight customers",
      args: {
        as_of: "2025-06-01",
        customers: [
          { customer_id: "a", last_order_date: "2025-05-28", orders: 6, revenue: 940 },
          { customer_id: "b", last_order_date: "2025-05-20", orders: 1, revenue: 310 },
          { customer_id: "c", last_order_date: "2025-04-02", orders: 3, revenue: 420 },
          { customer_id: "d", last_order_date: "2025-02-11", orders: 2, revenue: 150 },
          { customer_id: "e", last_order_date: "2024-12-30", orders: 1, revenue: 80 },
          { customer_id: "f", last_order_date: "2024-10-15", orders: 4, revenue: 700 },
          { customer_id: "g", last_order_date: "2024-07-01", orders: 1, revenue: 35 },
          { customer_id: "h", last_order_date: "2024-03-09", orders: 2, revenue: 520 },
        ],
      },
    },
  ],
};
