import { ToolInputError } from "../server/tool";
import { pooledTwoProportionTest } from "./abtest";
import { welchTTest } from "./stats";

export type EmailArm = "mens" | "womens" | "control";
export type EmailDimension =
  | "overall"
  | "history_segment"
  | "zip_code"
  | "channel"
  | "newbie"
  | "mens"
  | "womens";

/** One aggregated cell of data/hillstrom_cells.json. */
export type EmailCell = {
  arm: EmailArm;
  dimension: EmailDimension;
  value: string;
  n: number;
  visits: number;
  conversions: number;
  spend_sum: number;
  spend_sq_sum: number;
};

export type EmailData = { source: string; license_note: string; cells: EmailCell[] };

export type EmailCampaign = "mens" | "womens";
export type EmailMetric = "visit" | "conversion" | "spend";
export type EmailSegmentBy = Exclude<EmailDimension, "overall">;

export type EmailRow = {
  segment: string;
  control_value: number;
  treatment_value: number;
  absolute_uplift: number;
  relative_uplift: number | null;
  p_value: number;
  significant: boolean;
  n_control: number;
  n_treatment: number;
};

export type EmailTestResult = {
  campaign: EmailCampaign;
  metric: EmailMetric;
  rows: EmailRow[];
  warnings: string[];
  source: string;
};

const ALPHA = 0.05;
const MIN_EVENTS = 30;
const EVENT_NOUN: Record<EmailMetric, string> = {
  visit: "visits",
  conversion: "conversions",
  spend: "conversions (purchases)",
};

function metricValue(cell: EmailCell, metric: EmailMetric): number {
  if (metric === "visit") return cell.visits / cell.n;
  if (metric === "conversion") return cell.conversions / cell.n;
  return cell.spend_sum / cell.n;
}

function eventCount(cell: EmailCell, metric: EmailMetric): number {
  return metric === "visit" ? cell.visits : cell.conversions;
}

/** Sample variance (n - 1 denominator) of spend per recipient, from the sum and sum of squares. */
function spendVariance(cell: EmailCell): number {
  const mean = cell.spend_sum / cell.n;
  return Math.max(0, (cell.spend_sq_sum - cell.n * mean * mean) / (cell.n - 1));
}

function pValue(control: EmailCell, treatment: EmailCell, metric: EmailMetric): number {
  if (metric === "spend") {
    return welchTTest(
      control.spend_sum / control.n,
      spendVariance(control),
      control.n,
      treatment.spend_sum / treatment.n,
      spendVariance(treatment),
      treatment.n,
    ).pValue;
  }
  const count = (c: EmailCell) => eventCount(c, metric);
  return pooledTwoProportionTest(count(control), control.n, count(treatment), treatment.n).pValue;
}

export function analyzeEmailTest(
  data: EmailData,
  args: { campaign?: EmailCampaign; metric?: EmailMetric; segment_by?: EmailSegmentBy },
): EmailTestResult {
  const campaign = args.campaign ?? "mens";
  const metric = args.metric ?? "conversion";
  const dimension: EmailDimension = args.segment_by ?? "overall";

  const cells = data.cells.filter((c) => c.dimension === dimension);
  const values = [...new Set(cells.map((c) => c.value))].sort();
  if (values.length === 0) throw new ToolInputError(`The summary has no cells for ${dimension}.`);
  const find = (arm: EmailArm, value: string) =>
    cells.find((c) => c.arm === arm && c.value === value);

  const rows: EmailRow[] = [];
  const warnings: string[] = [];
  const thinSegments: string[] = [];
  const undefinedRelative: string[] = [];

  for (const value of values) {
    const control = find("control", value);
    const treatment = find(campaign, value);
    if (!control || !treatment) {
      throw new ToolInputError(
        `The summary has no ${control ? campaign : "control"} cell for ${dimension} = ${value}.`,
      );
    }
    const controlValue = metricValue(control, metric);
    const treatmentValue = metricValue(treatment, metric);
    const uplift = treatmentValue - controlValue;
    const p = pValue(control, treatment, metric);
    const segment = dimension === "overall" ? "all" : value;
    if (
      Math.min(eventCount(control, metric), eventCount(treatment, metric)) < MIN_EVENTS ||
      Math.min(control.n, treatment.n) < MIN_EVENTS
    ) {
      thinSegments.push(segment);
    }
    if (controlValue === 0) undefinedRelative.push(segment);
    rows.push({
      segment,
      control_value: controlValue,
      treatment_value: treatmentValue,
      absolute_uplift: uplift,
      relative_uplift: controlValue === 0 ? null : uplift / controlValue,
      p_value: p,
      significant: p < ALPHA,
      n_control: control.n,
      n_treatment: treatment.n,
    });
  }

  if (thinSegments.length > 0) {
    warnings.push(
      `Fewer than ${MIN_EVENTS} ${EVENT_NOUN[metric]} in at least one arm for: ${thinSegments.join(", ")}; results there may be unreliable.`,
    );
  }
  if (undefinedRelative.length > 0) {
    warnings.push(
      `The control value is 0 for ${undefinedRelative.join(", ")}, so the relative uplift is undefined there.`,
    );
  }
  if (rows.length > 1) {
    warnings.push(
      `${rows.length} segments were tested separately without correcting for multiple comparisons, so one can look significant by chance.`,
    );
  }
  if (metric === "spend") {
    warnings.push(
      "Spend is zero for most recipients (a very skewed distribution), so spend p-values are less reliable in small segments.",
    );
  }

  return { campaign, metric, rows, warnings, source: data.source };
}
