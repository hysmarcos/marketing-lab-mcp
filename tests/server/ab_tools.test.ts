import type { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connectInMemory } from "./helpers";

let client: Client;

beforeAll(async () => {
  client = await connectInMemory();
});

afterAll(async () => {
  await client.close();
});

describe("ab_test_plan input", () => {
  it("rejects an mde_relative too small to matter", async () => {
    const result = await client.callTool({
      name: "ab_test_plan",
      arguments: { baseline_rate: 0.03, mde_relative: 1e-15 },
    });
    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text: string }[];
    expect(content[0]?.text).toContain("mde_relative");
  });

  it("returns finite numbers for a normal request", async () => {
    const result = await client.callTool({
      name: "ab_test_plan",
      arguments: { baseline_rate: 0.03, mde_relative: 0.2, daily_visitors: 2000 },
    });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as { per_variant: number; days: number };
    expect(Number.isFinite(out.per_variant)).toBe(true);
    expect(out.days).toBeGreaterThan(0);
  });
});
