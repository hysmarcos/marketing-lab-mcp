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

describe("store_sales", () => {
  it("is registered after budget_optimize", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names.indexOf("store_sales")).toBe(names.indexOf("budget_optimize") + 1);
  });

  it("rejects a misspelled field", async () => {
    const result = await client.callTool({
      name: "store_sales",
      arguments: { group_by: "category", categoy: "beleza" },
    });
    expect(result.isError).toBe(true);
  });

  it("returns a tool error for from_month after to_month", async () => {
    const result = await client.callTool({
      name: "store_sales",
      arguments: { group_by: "month", from_month: "2018-05", to_month: "2018-01" },
    });
    expect(result.isError).toBe(true);
  });

  it("keeps the summary within the limit for every grouping and metric", async () => {
    for (const group_by of ["category", "state", "month"]) {
      for (const metric of ["revenue", "orders", "avg_review", "late_delivery_rate"]) {
        for (const top of [1, 10, 50]) {
          const r = await client.callTool({
            name: "store_sales",
            arguments: { group_by, metric, top },
          });
          expect(r.isError).toBeFalsy();
          const text = (r.content as { text: string }[])[0]?.text ?? "";
          expect(text.length).toBeLessThanOrEqual(1200);
        }
      }
    }
  });

  it("keeps the summary within the limit for an unknown category", async () => {
    const r = await client.callTool({
      name: "store_sales",
      arguments: { group_by: "state", category: "beleza" },
    });
    const text = (r.content as { text: string }[])[0]?.text ?? "";
    expect(text.length).toBeLessThanOrEqual(1200);
    expect(text.length).toBeGreaterThan(0);
  });
});
