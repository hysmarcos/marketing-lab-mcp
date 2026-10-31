import type { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TOOLS } from "../../src/server/tools";
import { customerRfm } from "../../src/server/tools/customer_rfm";
import parity from "../fixtures/rfm_parity.json";
import { connectInMemory } from "./helpers";

let client: Client;

beforeAll(async () => {
  client = await connectInMemory();
});

afterAll(async () => {
  await client.close();
});

const summaryOf = (r: { content?: unknown }) => (r.content as { text: string }[])[0]?.text ?? "";

describe("customer_rfm", () => {
  it("is registered right after store_sales", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names.indexOf("customer_rfm")).toBe(names.indexOf("store_sales") + 1);
  });

  it("answers with no arguments in Olist mode", async () => {
    const result = await client.callTool({ name: "customer_rfm", arguments: {} });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as { mode: string; segments: unknown[] };
    expect(out.mode).toBe("olist");
    expect(out.segments).toHaveLength(7);
    expect(summaryOf(result).length).toBeLessThanOrEqual(1200);
  });

  it("scores user customers and says the source is user input", async () => {
    const result = await client.callTool({
      name: "customer_rfm",
      arguments: {
        as_of: parity.as_of,
        customers: parity.customers.map((c) => ({
          customer_id: c.customer_id,
          last_order_date: c.last_order_date,
          orders: c.orders,
          revenue: c.revenue,
        })),
      },
    });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as { mode: string; source: string };
    expect(out.mode).toBe("custom");
    expect(out.source).toBe("user input");
    expect(summaryOf(result).length).toBeLessThanOrEqual(1200);
  });

  it("returns a tool error for 2,001 customers", async () => {
    const customers = Array.from({ length: 2001 }, (_, i) => ({
      customer_id: `c${i}`,
      last_order_date: "2024-01-01",
      orders: 1,
      revenue: 1,
    }));
    const result = await client.callTool({ name: "customer_rfm", arguments: { customers } });
    expect(result.isError).toBe(true);
  });

  it("rejects an unknown segment and a misspelled field", async () => {
    const a = await client.callTool({ name: "customer_rfm", arguments: { segment: "vip" } });
    expect(a.isError).toBe(true);
    const b = await client.callTool({ name: "customer_rfm", arguments: { stat: "SP" } });
    expect(b.isError).toBe(true);
  });

  it("reports an invalid date as a tool error naming the problem", async () => {
    const result = await client.callTool({
      name: "customer_rfm",
      arguments: {
        customers: [{ customer_id: "a", last_order_date: "2024-02-30", orders: 1, revenue: 5 }],
      },
    });
    expect(result.isError).toBe(true);
    expect(summaryOf(result)).toMatch(/date/i);
  });

  it("keeps the summary within the limit for an unknown state", async () => {
    const result = await client.callTool({ name: "customer_rfm", arguments: { state: "XX" } });
    expect(result.isError).toBeFalsy();
    expect(summaryOf(result).length).toBeLessThanOrEqual(1200);
  });
});

const clock = (globalThis as unknown as { performance: { now(): number } }).performance;

describe("customer_rfm CPU budget", () => {
  it("parses and scores 2,000 customers in under 5 ms (median of 20 runs)", () => {
    const customers = Array.from({ length: 2000 }, (_, i) => {
      const day = 1 + (i % 28);
      const month = 1 + (i % 12);
      return {
        customer_id: `customer-${i}`,
        last_order_date: `2024-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
        orders: 1 + (i % 5),
        revenue: Math.round(((i * 7919) % 100000) / 7) / 10,
      };
    });
    const times: number[] = [];
    for (let run = 0; run < 20; run++) {
      const start = clock.now();
      const parsed = customerRfm.input.parse({ customers });
      const out = customerRfm.run(parsed);
      customerRfm.summarize(out);
      times.push(clock.now() - start);
    }
    times.sort((a, b) => a - b);
    const median = ((times[9] ?? 0) + (times[10] ?? 0)) / 2;
    expect(median).toBeLessThan(5);
  });
});
