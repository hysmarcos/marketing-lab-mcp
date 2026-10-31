import type { ToolSpec } from "../tool";
import { abTestEvaluate } from "./ab_test_evaluate";
import { abTestPlan } from "./ab_test_plan";
import { emailTestAnalyze } from "./email_test_analyze";

/** Every tool the server exposes. Adding a tool here also adds it to the contract tests. */
export const TOOLS: ToolSpec[] = [abTestEvaluate, abTestPlan, emailTestAnalyze];
