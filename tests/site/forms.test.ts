import type { Client, Tool } from "@modelcontextprotocol/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  argsFromFields,
  type Field,
  FormError,
  fieldsFromSchema,
  type JSONSchema,
  valuesFromArgs,
} from "../../site/src/forms";
import { TOOLS } from "../../src/server/tools";
import { connectInMemory } from "../server/helpers";

let client: Client;
let listed: Tool[];

beforeAll(async () => {
  client = await connectInMemory();
  listed = (await client.listTools()).tools;
});

afterAll(async () => {
  await client.close();
});

/** The input schema exactly as the server sends it over the wire. */
function schemaOf(name: string): JSONSchema {
  const tool = listed.find((t) => t.name === name);
  if (!tool) throw new Error(`${name} is not listed`);
  return tool.inputSchema as JSONSchema;
}

function field(fields: Field[], path: string): Field {
  const parts = path.split(".");
  let list = fields;
  let found: Field | undefined;
  for (const part of parts) {
    found = list.find((f) => f.name === part);
    if (!found) throw new Error(`no field ${path}`);
    list = found.kind === "object" ? found.fields : [];
  }
  return found as Field;
}

function issuesOf(fn: () => unknown): { path: string; message: string }[] {
  try {
    fn();
  } catch (error) {
    if (error instanceof FormError) return error.issues;
    throw error;
  }
  throw new Error("expected a FormError");
}

describe("fieldsFromSchema -> argsFromFields round trip", () => {
  const cases = TOOLS.flatMap((spec) =>
    spec.examples.map((example) => [spec.name, example.label, example.args] as const),
  );

  it("covers every example of every tool", () => {
    expect(cases.length).toBe(TOOLS.reduce((n, spec) => n + spec.examples.length, 0));
    expect(new Set(cases.map(([name]) => name)).size).toBe(9);
  });

  it.each(cases)("%s: %s", (name, _label, args) => {
    const fields = fieldsFromSchema(schemaOf(name));
    const values = valuesFromArgs(fields, args);
    for (const value of Object.values(values)) expect(typeof value).toBe("string");
    expect(argsFromFields(fields, values)).toEqual(args);
  });
});

describe("fieldsFromSchema", () => {
  it("turns nested objects into fieldsets of whole numbers with their bounds", () => {
    const fields = fieldsFromSchema(schemaOf("ab_test_evaluate"));
    const control = field(fields, "control");
    expect(control.kind).toBe("object");
    expect(control.required).toBe(true);
    const visitors = field(fields, "control.visitors");
    expect(visitors).toMatchObject({
      kind: "number",
      integer: true,
      min: 1,
      required: true,
      path: "control.visitors",
    });
    expect(visitors.help).toContain("visitors");
    expect(field(fields, "confidence")).toMatchObject({
      kind: "number",
      integer: false,
      min: 0.8,
      max: 0.99,
      required: false,
    });
  });

  it("labels fields from their property names and uses the description as help", () => {
    const fields = fieldsFromSchema(schemaOf("ab_test_plan"));
    const mde = field(fields, "mde_relative");
    expect(mde.label).toBe("MDE relative");
    expect(mde.help).toMatch(/^Smallest relative improvement/);
    expect(field(fields, "baseline_rate")).toMatchObject({ exclusiveMin: 0, exclusiveMax: 1 });
  });

  it("renders enums as selects", () => {
    const fields = fieldsFromSchema(schemaOf("email_test_analyze"));
    expect(field(fields, "campaign")).toMatchObject({ kind: "enum", options: ["mens", "womens"] });
    expect(field(fields, "segment_by").required).toBe(false);
  });

  it("gives the budget tools one optional per-channel fieldset with a floor of 0", () => {
    const simulate = fieldsFromSchema(schemaOf("budget_simulate"));
    const spend = field(simulate, "weekly_spend");
    expect(spend.kind).toBe("object");
    expect(spend.required).toBe(false);
    if (spend.kind !== "object") throw new Error("unreachable");
    expect(spend.fields.map((f) => f.name)).toEqual(["tv", "ooh", "print", "facebook", "search"]);
    for (const channel of spend.fields) expect(channel).toMatchObject({ kind: "number", min: 0 });
    expect(field(simulate, "weekly_spend.tv").label).toBe("TV");

    const optimize = fieldsFromSchema(schemaOf("budget_optimize"));
    expect(field(optimize, "min").kind).toBe("object");
    expect(field(optimize, "max.search")).toMatchObject({ kind: "number", min: 0 });
  });

  it("uses a JSON textarea for arrays of objects", () => {
    const journeys = field(fieldsFromSchema(schemaOf("attribution_compare")), "journeys");
    expect(journeys).toMatchObject({ kind: "json", required: false });
    const customers = field(fieldsFromSchema(schemaOf("customer_rfm")), "customers");
    expect(customers).toMatchObject({ kind: "json", required: false });
  });

  it("supports strings with a pattern and booleans", () => {
    const fields = fieldsFromSchema({
      type: "object",
      properties: {
        month: { type: "string", pattern: "^\\d{4}-\\d{2}$", description: "Month." },
        dry_run: { type: "boolean", description: "Only check the input." },
      },
      required: ["dry_run"],
    });
    expect(field(fields, "month")).toMatchObject({ kind: "string", pattern: "^\\d{4}-\\d{2}$" });
    expect(field(fields, "dry_run")).toMatchObject({ kind: "boolean", required: true });
    expect(argsFromFields(fields, { month: "", dry_run: "true" })).toEqual({ dry_run: true });
    expect(argsFromFields(fields, { month: "2018-01", dry_run: "false" })).toEqual({
      month: "2018-01",
      dry_run: false,
    });
  });
});

describe("argsFromFields", () => {
  it("does not send empty optional fields", () => {
    const fields = fieldsFromSchema(schemaOf("ab_test_plan"));
    expect(
      argsFromFields(fields, {
        baseline_rate: "0.03",
        mde_relative: "0.2",
        alpha: "",
        power: "  ",
        variants: "",
        daily_visitors: "",
      }),
    ).toEqual({ baseline_rate: 0.03, mde_relative: 0.2 });
  });

  it("drops an optional fieldset when every field in it is empty", () => {
    const fields = fieldsFromSchema(schemaOf("budget_simulate"));
    expect(argsFromFields(fields, { "weekly_spend.tv": "", "weekly_spend.search": "" })).toEqual(
      {},
    );
    expect(argsFromFields(fields, { "weekly_spend.search": "18000" })).toEqual({
      weekly_spend: { search: 18000 },
    });
  });

  it("names a missing required field", () => {
    const fields = fieldsFromSchema(schemaOf("ab_test_evaluate"));
    const issues = issuesOf(() =>
      argsFromFields(fields, {
        "control.visitors": "100",
        "control.conversions": "",
        "variant.visitors": "100",
        "variant.conversions": "5",
      }),
    );
    expect(issues).toEqual([
      { path: "control.conversions", message: expect.stringContaining("Conversions") },
    ]);
  });

  it("rejects text, fractions and out-of-range numbers with a message that says what to enter", () => {
    const fields = fieldsFromSchema(schemaOf("ab_test_plan"));
    const issues = issuesOf(() =>
      argsFromFields(fields, {
        baseline_rate: "three percent",
        mde_relative: "0.2",
        variants: "2.5",
        power: "1",
      }),
    );
    expect(issues.map((i) => i.path)).toEqual(["baseline_rate", "power", "variants"]);
    expect(issues[0]?.message).toMatch(/number/);
    expect(issues[1]?.message).toMatch(/less than 1/);
    expect(issues[2]?.message).toMatch(/whole number/);
  });

  it("rejects JSON that does not parse or is not a list", () => {
    const fields = fieldsFromSchema(schemaOf("attribution_compare"));
    expect(issuesOf(() => argsFromFields(fields, { journeys: "[{" }))[0]?.message).toMatch(/JSON/);
    expect(
      issuesOf(() => argsFromFields(fields, { journeys: '{"path": []}' }))[0]?.message,
    ).toMatch(/list/);
  });

  it("checks a string pattern", () => {
    const fields = fieldsFromSchema(schemaOf("store_sales"));
    const issues = issuesOf(() =>
      argsFromFields(fields, { group_by: "month", from_month: "Jan 2018" }),
    );
    expect(issues).toEqual([{ path: "from_month", message: expect.any(String) }]);
  });
});
