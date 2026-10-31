// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import {
  inputRows,
  NO_RUN_NOTE,
  RUN_FAILED_NOTE,
  RUN_LABEL,
  RUNNING_LABEL,
  renderTicket,
  setTicketStamp,
  type TicketStamp,
} from "../../site/src/ticket";
import { TOOLS } from "../../src/server/tools";

const input = {
  control: { visitors: 10000, conversions: 500 },
  variant: { visitors: 10000, conversions: 570 },
};

const runButton = (ticket: HTMLElement) =>
  ticket.querySelector<HTMLButtonElement>(".ticket__run") as HTMLButtonElement;

describe("inputRows", () => {
  it("flattens nested objects into dotted keys", () => {
    expect(inputRows(input)).toEqual([
      { key: "control.visitors", value: "10000" },
      { key: "control.conversions", value: "500" },
      { key: "variant.visitors", value: "10000" },
      { key: "variant.conversions", value: "570" },
    ]);
  });

  it("keeps short arrays inline and counts long or nested ones", () => {
    const rows = inputRows({
      channels: ["tv", "search"],
      journeys: [{ path: ["email"], conversions: 1 }],
      name: "plan",
    });
    expect(rows).toEqual([
      { key: "channels", value: '["tv", "search"]' },
      { key: "journeys", value: "1 item" },
      { key: "name", value: '"plan"' },
    ]);
  });

  it("clips very long values", () => {
    const [row] = inputRows({ note: "x".repeat(200) });
    expect(row?.value.length).toBeLessThanOrEqual(48);
    expect(row?.value.endsWith("…")).toBe(true);
  });

  it("formats every tool's example inputs without throwing", () => {
    for (const tool of TOOLS) {
      for (const example of tool.examples) {
        expect(() => inputRows(example.args as Record<string, unknown>)).not.toThrow();
      }
    }
  });
});

describe("renderTicket", () => {
  it("prints the tool name and its inputs", () => {
    const ticket = renderTicket({ tool: "ab_test_evaluate", input });
    expect(ticket.querySelector(".ticket__tool")?.textContent).toBe("ab_test_evaluate");
    const keys = [...ticket.querySelectorAll("dt")].map((dt) => dt.textContent);
    expect(keys).toEqual([
      "control.visitors",
      "control.conversions",
      "variant.visitors",
      "variant.conversions",
    ]);
    expect(ticket.getAttribute("aria-labelledby")).toBe(ticket.querySelector(".ticket__tool")?.id);
  });

  it("says when there are no arguments", () => {
    const ticket = renderTicket({ tool: "attribution_compare", input: {} });
    expect(ticket.querySelector(".ticket__empty")?.textContent).toBe("No arguments");
  });

  it("disables the run button and explains why when there is no onRun", () => {
    const ticket = renderTicket({ tool: "ab_test_evaluate", input });
    const button = runButton(ticket);
    expect(button.textContent).toBe(RUN_LABEL);
    expect(button.disabled).toBe(true);
    expect(button.title).toBe(NO_RUN_NOTE);
    const note = ticket.querySelector(".ticket__note");
    expect(note?.textContent).toBe(NO_RUN_NOTE);
    expect(button.getAttribute("aria-describedby")).toBe(note?.id);
  });

  it("enables the run button when onRun is given", () => {
    const ticket = renderTicket({ tool: "ab_test_evaluate", input, onRun: async () => {} });
    expect(runButton(ticket).disabled).toBe(false);
    expect(ticket.querySelector(".ticket__note")?.textContent).toBe("");
  });

  it("shows a busy state while running and ignores double clicks", async () => {
    let finish: () => void = () => {};
    const onRun = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = resolve;
        }),
    );
    const ticket = renderTicket({ tool: "ab_test_evaluate", input, onRun });
    const button = runButton(ticket);

    button.click();
    button.click();
    expect(onRun).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toBe(RUNNING_LABEL);
    expect(ticket.getAttribute("aria-busy")).toBe("true");

    finish();
    await vi.waitFor(() => expect(button.textContent).toBe(RUN_LABEL));
    expect(button.disabled).toBe(false);
    expect(ticket.hasAttribute("aria-busy")).toBe(false);
  });

  it("says the run failed and what to do when onRun rejects", async () => {
    const ticket = renderTicket({
      tool: "ab_test_evaluate",
      input,
      onRun: () => Promise.reject(new Error("offline")),
    });
    const button = runButton(ticket);
    button.click();
    await vi.waitFor(() =>
      expect(ticket.querySelector(".ticket__note")?.textContent).toBe(RUN_FAILED_NOTE),
    );
    expect(button.disabled).toBe(false);
    expect(button.getAttribute("aria-describedby")).toBe(ticket.querySelector(".ticket__note")?.id);
  });
});

describe("stamps", () => {
  it("has no stamp by default", () => {
    const ticket = renderTicket({ tool: "ab_test_evaluate", input });
    expect(ticket.querySelector(".stamp")).toBeNull();
    expect(ticket.dataset.stamped).toBeUndefined();
  });

  it("stamps a match", () => {
    const ticket = renderTicket({ tool: "ab_test_evaluate", input, stamp: { kind: "match" } });
    expect(ticket.querySelector(".stamp__title")?.textContent).toBe("Matches recording");
    expect(ticket.querySelector(".stamp__changed")).toBeNull();
    expect(ticket.dataset.stamped).toBe("match");
  });

  it("stamps a difference with the changed fields", () => {
    const ticket = renderTicket({
      tool: "ab_test_evaluate",
      input,
      stamp: { kind: "differs", changed: ["p_value", "variant_rate"] },
    });
    expect(ticket.querySelector(".stamp__title")?.textContent).toBe("Different from recording");
    expect(ticket.querySelector(".stamp__changed")?.textContent).toBe(
      "Changed: p_value, variant_rate",
    );
  });

  it("replaces and removes the stamp inside a polite live region", () => {
    const ticket = renderTicket({ tool: "ab_test_evaluate", input });
    const slot = ticket.querySelector(".ticket__stamp-slot");
    expect(slot?.getAttribute("aria-live")).toBe("polite");

    setTicketStamp(ticket, { kind: "match" });
    setTicketStamp(ticket, { kind: "differs", changed: ["p_value"] });
    expect(ticket.querySelectorAll(".stamp")).toHaveLength(1);
    expect(ticket.dataset.stamped).toBe("differs");

    setTicketStamp(ticket, undefined);
    expect(ticket.querySelector(".stamp")).toBeNull();
    expect(ticket.dataset.stamped).toBeUndefined();
  });

  it("shows no stamp for an unknown kind", () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ticket = renderTicket({ tool: "ab_test_evaluate", input, stamp: { kind: "match" } });
    setTicketStamp(ticket, { kind: "maybe" } as unknown as TicketStamp);
    expect(ticket.querySelector(".stamp")).toBeNull();
    expect(ticket.dataset.stamped).toBeUndefined();
    expect(error).toHaveBeenCalledOnce();
    error.mockRestore();
  });

  it("refuses elements that are not tickets", () => {
    expect(() => setTicketStamp(document.createElement("div"), { kind: "match" })).toThrow();
  });
});
