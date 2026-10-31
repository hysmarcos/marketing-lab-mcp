import type { Client } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MAX_SUMMARY_LENGTH } from "../../src/server/tool";
import { TOOLS } from "../../src/server/tools";
import { connectInMemory } from "./helpers";

let client: Client;

beforeAll(async () => {
  client = await connectInMemory();
});

afterAll(async () => {
  await client.close();
});

describe("tool contract", () => {
  it("lists exactly the registered tools", async () => {
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });

  it.each(TOOLS.map((t) => [t.name, t] as const))(
    "%s has a useful description and an object input schema",
    async (name) => {
      const { tools } = await client.listTools();
      const tool = tools.find((t) => t.name === name);
      expect(tool).toBeDefined();
      expect((tool?.description ?? "").length).toBeGreaterThanOrEqual(80);
      expect(tool?.inputSchema.type).toBe("object");
    },
  );

  it.each(TOOLS.map((t) => [t.name, t] as const))(
    "%s rejects unknown input keys",
    async (name, spec) => {
      const example = spec.examples[0];
      const result = await client.callTool({
        name,
        arguments: { ...example?.args, definitely_not_a_field: 1 },
      });
      expect(result.isError).toBe(true);
      const content = result.content as { type: string; text: string }[];
      expect(content[0]?.text).toContain("definitely_not_a_field");
    },
  );

  for (const spec of TOOLS) {
    describe(spec.name, () => {
      it("has at least one example", () => {
        expect(spec.examples.length).toBeGreaterThanOrEqual(1);
      });

      it.each(spec.examples.map((e) => [e.label, e.args] as const))(
        "answers the example %s",
        async (_label, args) => {
          const result = await client.callTool({ name: spec.name, arguments: args });
          expect(result.isError).toBeFalsy();
          const content = result.content as { type: string; text: string }[];
          expect(content[0]?.type).toBe("text");
          expect(content[0]?.text.length).toBeGreaterThan(0);
          expect(content[0]?.text.length).toBeLessThanOrEqual(MAX_SUMMARY_LENGTH);
          const structured = result.structuredContent as Record<string, unknown>;
          expect(Array.isArray(structured.warnings)).toBe(true);
          expect(typeof structured.source).toBe("string");
        },
      );
    });
  }
});

describe("errors", () => {
  it("returns a tool error that names the offending field", async () => {
    const result = await client.callTool({
      name: "ab_test_evaluate",
      arguments: {
        control: { visitors: 10, conversions: 20 },
        variant: { visitors: 10, conversions: 1 },
      },
    });
    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text: string }[];
    expect(content[0]?.text).toContain("conversions");
  });

  it("returns a tool error for a missing required field", async () => {
    const result = await client.callTool({
      name: "ab_test_evaluate",
      arguments: { control: { visitors: 10, conversions: 1 } },
    });
    expect(result.isError).toBe(true);
    const content = result.content as { type: string; text: string }[];
    expect(content[0]?.text).toContain("variant");
  });

  it("does not crash on an unknown tool name", async () => {
    await expect(client.callTool({ name: "no_such_tool", arguments: {} })).rejects.toThrow(
      /not found/,
    );
    // The server must still answer afterwards.
    const { tools } = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
  });
});
