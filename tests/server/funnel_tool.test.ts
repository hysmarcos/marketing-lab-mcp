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

const summaryOf = (r: { content?: unknown }) => (r.content as { text: string }[])[0]?.text ?? "";

describe("lead_funnel", () => {
  it("is registered right after customer_rfm", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names.indexOf("lead_funnel")).toBe(names.indexOf("customer_rfm") + 1);
  });

  it("answers with no arguments", async () => {
    const result = await client.callTool({ name: "lead_funnel", arguments: {} });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as {
      group_by: string;
      totals: { mqls: number; deals: number };
    };
    expect(out.group_by).toBe("origin");
    expect(out.totals).toMatchObject({ mqls: 8000, deals: 842 });
  });

  it("keeps the summary within the limit for every grouping, with and without filters", async () => {
    for (const group_by of ["origin", "business_segment", "month"]) {
      for (const extra of [
        {},
        { origin: "paid_search" },
        { from_month: "2018-01" },
        { origin: "tiktok" },
      ]) {
        const r = await client.callTool({
          name: "lead_funnel",
          arguments: { group_by, ...extra },
        });
        expect(r.isError).toBeFalsy();
        const text = summaryOf(r);
        expect(text.length).toBeGreaterThan(0);
        expect(text.length).toBeLessThanOrEqual(1200);
      }
    }
  });

  it("rejects a misspelled field and an unknown grouping", async () => {
    const a = await client.callTool({ name: "lead_funnel", arguments: { orign: "email" } });
    expect(a.isError).toBe(true);
    const b = await client.callTool({ name: "lead_funnel", arguments: { group_by: "region" } });
    expect(b.isError).toBe(true);
  });

  it("returns a tool error for from_month after to_month", async () => {
    const result = await client.callTool({
      name: "lead_funnel",
      arguments: { from_month: "2018-05", to_month: "2018-01" },
    });
    expect(result.isError).toBe(true);
  });
});
