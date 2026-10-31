import type { ToolSpec } from "../tool";
import { abTestEvaluate } from "./ab_test_evaluate";
import { abTestPlan } from "./ab_test_plan";
import { budgetOptimize } from "./budget_optimize";
import { budgetSimulate } from "./budget_simulate";
import { customerRfm } from "./customer_rfm";
import { emailTestAnalyze } from "./email_test_analyze";
import { leadFunnel } from "./lead_funnel";
import { storeSales } from "./store_sales";

/** Every tool the server exposes. Adding a tool here also adds it to the contract tests. */
export const TOOLS: ToolSpec[] = [
  abTestEvaluate,
  abTestPlan,
  emailTestAnalyze,
  budgetSimulate,
  budgetOptimize,
  storeSales,
  customerRfm,
  leadFunnel,
];
