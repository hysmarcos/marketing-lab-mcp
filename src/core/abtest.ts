import { ToolInputError } from "../server/tool";
import { chiSquare1Sf, normalCdf, normalPpf } from "./stats";

export type Arm = { visitors: number; conversions: number };

export type AbTestResult = {
  control_rate: number;
  variant_rate: number;
  absolute_diff: number;
  relative_lift: number | null;
  ci_low: number;
  ci_high: number;
  p_value: number;
  significant: boolean;
  prob_variant_better: number;
  srm_p_value: number;
  srm_detected: boolean;
  warnings: string[];
  source: string;
};

export type AbTestPlan = {
  per_variant: number;
  total: number;
  days: number | null;
  warnings: string[];
  source: string;
};

const SRM_THRESHOLD = 0.001;
const MIN_COUNT = 30;
const LONG_TEST_DAYS = 90;

function checkArm(name: string, arm: Arm): void {
  if (!Number.isInteger(arm.visitors) || arm.visitors < 1) {
    throw new ToolInputError(`${name}.visitors must be a positive integer.`);
  }
  if (!Number.isInteger(arm.conversions) || arm.conversions < 0) {
    throw new ToolInputError(`${name}.conversions must be a non-negative integer.`);
  }
  if (arm.conversions > arm.visitors) {
    throw new ToolInputError(
      `${name}.conversions (${arm.conversions}) cannot be greater than ${name}.visitors (${arm.visitors}).`,
    );
  }
}

function checkRange(name: string, value: number, min: number, max: number): void {
  if (!(value >= min && value <= max)) {
    throw new ToolInputError(`${name} must be between ${min} and ${max}.`);
  }
}

/** Posterior mean and variance of Beta(1 + c, 1 + n - c), a uniform prior. */
function betaPosterior(arm: Arm): { mean: number; variance: number } {
  const alpha = 1 + arm.conversions;
  const beta = 1 + arm.visitors - arm.conversions;
  const total = alpha + beta;
  return { mean: alpha / total, variance: (alpha * beta) / (total * total * (total + 1)) };
}

export function evaluateAbTest(args: {
  control: Arm;
  variant: Arm;
  confidence?: number;
  expected_split?: number;
}): AbTestResult {
  const { control, variant } = args;
  const confidence = args.confidence ?? 0.95;
  const expectedSplit = args.expected_split ?? 0.5;
  checkArm("control", control);
  checkArm("variant", variant);
  checkRange("confidence", confidence, 0.8, 0.99);
  checkRange("expected_split", expectedSplit, 0.01, 0.99);

  const warnings: string[] = [];
  const nA = control.visitors;
  const nB = variant.visitors;
  const pA = control.conversions / nA;
  const pB = variant.conversions / nB;
  const diff = pB - pA;

  // Two-sided pooled two-proportion z-test.
  const pooled = (control.conversions + variant.conversions) / (nA + nB);
  const pooledSe = Math.sqrt(pooled * (1 - pooled) * (1 / nA + 1 / nB));
  let pValue = 1;
  if (pooledSe > 0) {
    // Use the lower tail directly: 1 - cdf would lose precision for tiny p-values.
    pValue = Math.min(1, 2 * normalCdf(-Math.abs(diff / pooledSe)));
  } else {
    warnings.push(
      "Both arms have either no conversions or only conversions, so the test cannot tell them apart (p-value set to 1).",
    );
  }

  // Unpooled Wald interval for the absolute difference.
  const se = Math.sqrt((pA * (1 - pA)) / nA + (pB * (1 - pB)) / nB);
  const zCrit = normalPpf(1 - (1 - confidence) / 2);
  const ciLow = diff - zCrit * se;
  const ciHigh = diff + zCrit * se;

  // Bayesian: P(variant > control), normal approximation to the Beta posteriors.
  const a = betaPosterior(control);
  const b = betaPosterior(variant);
  const probVariantBetter = normalCdf((b.mean - a.mean) / Math.sqrt(a.variance + b.variance));

  // Sample ratio mismatch: chi-square, 1 degree of freedom.
  const total = nA + nB;
  const expectedA = total * expectedSplit;
  const expectedB = total * (1 - expectedSplit);
  const chi2 = (nA - expectedA) ** 2 / expectedA + (nB - expectedB) ** 2 / expectedB;
  const srmPValue = chiSquare1Sf(chi2);
  const srmDetected = srmPValue < SRM_THRESHOLD;

  if (srmDetected) {
    warnings.push(
      `Sample ratio mismatch (p = ${srmPValue.toExponential(2)}): the traffic split differs from the expected ${expectedSplit}. Check the assignment before trusting these results.`,
    );
  }
  const small = [
    ["control", control],
    ["variant", variant],
  ] as const;
  for (const [name, arm] of small) {
    if (arm.conversions < MIN_COUNT || arm.visitors - arm.conversions < MIN_COUNT) {
      warnings.push(
        `The ${name} arm has fewer than ${MIN_COUNT} conversions or non-conversions; the normal approximations may be unreliable.`,
      );
    }
  }
  if (pA === 0) {
    warnings.push("Control conversion rate is 0, so the relative lift is undefined.");
  }

  return {
    control_rate: pA,
    variant_rate: pB,
    absolute_diff: diff,
    relative_lift: pA === 0 ? null : diff / pA,
    ci_low: ciLow,
    ci_high: ciHigh,
    p_value: pValue,
    significant: pValue < 1 - confidence,
    prob_variant_better: probVariantBetter,
    srm_p_value: srmPValue,
    srm_detected: srmDetected,
    warnings,
    source: "user input",
  };
}

export function planAbTest(args: {
  baseline_rate: number;
  mde_relative: number;
  alpha?: number;
  power?: number;
  variants?: number;
  daily_visitors?: number;
}): AbTestPlan {
  const p1 = args.baseline_rate;
  const mde = args.mde_relative;
  const alpha = args.alpha ?? 0.05;
  const power = args.power ?? 0.8;
  const variants = args.variants ?? 2;
  if (!(p1 > 0 && p1 < 1)) throw new ToolInputError("baseline_rate must be between 0 and 1.");
  if (!(mde > 0)) throw new ToolInputError("mde_relative must be greater than 0.");
  if (!(alpha > 0 && alpha < 0.5)) throw new ToolInputError("alpha must be between 0 and 0.5.");
  if (!(power > 0 && power < 1)) throw new ToolInputError("power must be between 0 and 1.");
  if (!Number.isInteger(variants) || variants < 2 || variants > 5) {
    throw new ToolInputError("variants must be an integer between 2 and 5.");
  }
  if (args.daily_visitors !== undefined && !(args.daily_visitors > 0)) {
    throw new ToolInputError("daily_visitors must be greater than 0.");
  }
  const p2 = p1 * (1 + mde);
  if (p2 >= 1) {
    throw new ToolInputError(
      `baseline_rate x (1 + mde_relative) = ${p2.toFixed(3)} must stay below 1; lower the expected lift.`,
    );
  }

  const warnings: string[] = [];
  let alphaUsed = alpha;
  if (variants > 2) {
    alphaUsed = alpha / (variants - 1);
    warnings.push(
      `Bonferroni correction applied for ${variants - 1} comparisons against control: alpha per comparison is ${alphaUsed.toFixed(4)}.`,
    );
  }
  const pBar = (p1 + p2) / 2;
  const zAlpha = normalPpf(1 - alphaUsed / 2);
  const zPower = normalPpf(power);
  const numerator =
    (zAlpha * Math.sqrt(2 * pBar * (1 - pBar)) +
      zPower * Math.sqrt(p1 * (1 - p1) + p2 * (1 - p2))) **
    2;
  const perVariant = Math.ceil(numerator / (p2 - p1) ** 2);
  const total = perVariant * variants;
  const days = args.daily_visitors === undefined ? null : Math.ceil(total / args.daily_visitors);
  if (days !== null && days > LONG_TEST_DAYS) {
    warnings.push(
      `The test would take ${days} days; consider a larger minimum detectable effect or more traffic.`,
    );
  }
  return { per_variant: perVariant, total, days, warnings, source: "user input" };
}
