import type { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TOOLS } from "../../src/server/tools";
import { connectInMemory } from "./helpers";

let client: Client;

beforeAll(async () => {
  client = await connectInMemory();
});

afterAll(async () => {
  await client.close();
});

const text = (r: { content: unknown }) => (r.content as { text: string }[])[0]?.text ?? "";

describe("budget tools", () => {
  it("are registered after email_test_analyze, simulate first", () => {
    expect(TOOLS.map((t) => t.name).slice(3, 5)).toEqual(["budget_simulate", "budget_optimize"]);
  });

  it("budget_simulate answers with no arguments (the current plan)", async () => {
    const r = await client.callTool({ name: "budget_simulate", arguments: {} });
    expect(r.isError).toBeFalsy();
    const out = r.structuredContent as { horizon_weeks: number; out_of_range: string[] };
    expect(out.horizon_weeks).toBe(13);
    expect(out.out_of_range).toEqual([]);
    expect(text(r).length).toBeLessThanOrEqual(1200);
  });

  it("budget_simulate returns a tool error naming the valid channels", async () => {
    const r = await client.callTool({
      name: "budget_simulate",
      arguments: { weekly_spend: { radio: 100 } },
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("radio");
    expect(text(r)).toContain("facebook");
  });

  it("budget_simulate flags out-of-range spend in the summary", async () => {
    const r = await client.callTool({
      name: "budget_simulate",
      arguments: { weekly_spend: { tv: 300000 } },
    });
    expect(r.isError).toBeFalsy();
    expect((r.structuredContent as { out_of_range: string[] }).out_of_range).toEqual(["tv"]);
    expect(text(r)).toContain("tv");
    expect(text(r).length).toBeLessThanOrEqual(1200);
  });

  it("budget_optimize answers with no arguments", async () => {
    const r = await client.callTool({ name: "budget_optimize", arguments: {} });
    expect(r.isError).toBeFalsy();
    const out = r.structuredContent as { allocation: Record<string, number> };
    expect(Object.keys(out.allocation)).toEqual(["tv", "ooh", "print", "facebook", "search"]);
    expect(text(r).length).toBeLessThanOrEqual(1200);
  });

  it("budget_optimize rejects a total above the cap", async () => {
    const r = await client.callTool({
      name: "budget_optimize",
      arguments: { total_weekly: 1_000_000 },
    });
    expect(r.isError).toBe(true);
  });
});
