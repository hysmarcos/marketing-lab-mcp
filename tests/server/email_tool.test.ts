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

describe("email_test_analyze", () => {
  it("is registered after the two A/B tools", () => {
    expect(TOOLS.map((t) => t.name).slice(0, 3)).toEqual([
      "ab_test_evaluate",
      "ab_test_plan",
      "email_test_analyze",
    ]);
  });

  it("answers with no arguments using the defaults", async () => {
    const result = await client.callTool({ name: "email_test_analyze", arguments: {} });
    expect(result.isError).toBeFalsy();
    const out = result.structuredContent as { campaign: string; rows: { segment: string }[] };
    expect(out.campaign).toBe("mens");
    expect(out.rows).toHaveLength(1);
  });

  it("returns three rows for zip_code and a summary within the limit for every segmentation", async () => {
    const zip = await client.callTool({
      name: "email_test_analyze",
      arguments: { segment_by: "zip_code" },
    });
    const rows = (zip.structuredContent as { rows: { segment: string }[] }).rows;
    expect(rows.map((r) => r.segment)).toEqual(["Rural", "Suburban", "Urban"]);
    for (const segment_by of [
      "history_segment",
      "zip_code",
      "channel",
      "newbie",
      "mens",
      "womens",
    ]) {
      for (const metric of ["visit", "conversion", "spend"]) {
        const r = await client.callTool({
          name: "email_test_analyze",
          arguments: { segment_by, metric, campaign: "womens" },
        });
        const text = (r.content as { text: string }[])[0]?.text ?? "";
        expect(text.length).toBeLessThanOrEqual(1200);
      }
    }
  });

  it("rejects an unknown metric", async () => {
    const result = await client.callTool({
      name: "email_test_analyze",
      arguments: { metric: "revenue" },
    });
    expect(result.isError).toBe(true);
  });
});
