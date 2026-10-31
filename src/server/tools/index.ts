import type { ToolSpec } from "../tool";
import { abTestEvaluate } from "./ab_test_evaluate";
import { abTestPlan } from "./ab_test_plan";

/** Every tool the server exposes. Adding a tool here also adds it to the contract tests. */
export const TOOLS: ToolSpec[] = [abTestEvaluate, abTestPlan];
