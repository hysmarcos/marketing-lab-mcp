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

  it("budget_simulate rejects an unknown channel at schema level and names the key", async () => {
    const r = await client.callTool({
      name: "budget_simulate",
      arguments: { weekly_spend: { radio: 100 } },
    });
    expect(r.isError).toBe(true);
    expect(text(r)).toContain("radio");
  });

  it("budget_simulate rejects negative spend", async () => {
    const r = await client.callTool({
      name: "budget_simulate",
      arguments: { weekly_spend: { tv: -5 } },
    });
    expect(r.isError).toBe(true);
  });

  it("budget_optimize rejects an unknown channel in min and max", async () => {
    for (const field of ["min", "max"]) {
      const r = await client.callTool({
        name: "budget_optimize",
        arguments: { [field]: { radio: 1 } },
      });
      expect(r.isError).toBe(true);
      expect(text(r)).toContain("radio");
    }
  });

  it("lists the five channels as properties in the input schema of all three fields", async () => {
    const { tools } = await client.listTools();
    const channels = ["tv", "ooh", "print", "facebook", "search"];
    const props = (name: string, field: string) => {
      const schema = tools.find((t) => t.name === name)?.inputSchema as {
        properties: Record<string, { properties?: Record<string, unknown> }>;
      };
      return Object.keys(schema.properties[field]?.properties ?? {});
    };
    expect(props("budget_simulate", "weekly_spend")).toEqual(channels);
    expect(props("budget_optimize", "min")).toEqual(channels);
    expect(props("budget_optimize", "max")).toEqual(channels);
  });

  it("examples use only the short channel names", () => {
    const short = new Set(["tv", "ooh", "print", "facebook", "search"]);
    for (const t of TOOLS.filter((x) => x.name.startsWith("budget_"))) {
      for (const e of t.examples) {
        for (const field of ["weekly_spend", "min", "max"]) {
          const obj = (e.args as Record<string, Record<string, number> | undefined>)[field] ?? {};
          for (const k of Object.keys(obj)) expect(short.has(k)).toBe(true);
        }
      }
    }
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
