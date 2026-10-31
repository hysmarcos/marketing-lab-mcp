import { describe, expect, it } from "vitest";
import {
  checkMonth,
  checkMonthRange,
  monthWindow,
  normalizeKey,
  round,
} from "../../src/core/query";
import { ToolInputError } from "../../src/server/tool";

describe("shared query helpers", () => {
  it("accepts YYYY-MM and rejects anything else", () => {
    expect(() => checkMonth("m", undefined)).not.toThrow();
    expect(() => checkMonth("m", "2018-03")).not.toThrow();
    for (const bad of ["2018-3", "2018-13", "2018-00", "March", "2018-03-01"]) {
      expect(() => checkMonth("m", bad)).toThrow(ToolInputError);
    }
  });

  it("rejects a range that runs backwards", () => {
    expect(() => checkMonthRange("2018-01", "2018-05")).not.toThrow();
    expect(() => checkMonthRange("2018-05", "2018-01")).toThrow(/after/);
  });

  it("resolves the window and warns only when it misses the data", () => {
    const months = ["2017-01", "2017-02", "2017-03"];
    const what = { noun: "sales", monthKind: "purchase" };
    expect(monthWindow(months, undefined, undefined, what)).toEqual({
      from: "2017-01",
      to: "2017-03",
      warning: null,
    });
    expect(monthWindow(months, "2017-03", "2019-01", what).warning).toBeNull();
    const miss = monthWindow(months, "2018-01", undefined, what);
    expect(miss.warning).toContain("2017-01 to 2017-03");
    expect(monthWindow(months, undefined, "2016-12", what).warning).not.toBeNull();
  });

  it("normalizes keys and rounds", () => {
    expect(normalizeKey("  Health-Beauty Items ")).toBe("health_beauty_items");
    expect(round(1.005 * 1000, 0)).toBe(1005);
    expect(round(2.34567, 2)).toBe(2.35);
  });
});
