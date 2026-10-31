// @vitest-environment happy-dom
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { callTool, connect } from "../../site/src/mcp";
import { mountPlayground } from "../../site/src/playground";
import {
  provideRunner,
  RUN_LABELS,
  resetSharedSession,
  setPlaygroundStarter,
  setSharedMode,
} from "../../site/src/session";
import {
  compareOutputs,
  parseTranscript,
  type Transcript,
  toolCalls,
} from "../../site/src/transcript-format";
import {
  footerText,
  loadTranscript,
  MAX_CHANGED,
  recordedTicket,
  renderConversation,
  renderHeroItems,
  renderTranscriptTabs,
  stampFor,
  TRANSCRIPT_IDS,
  VISIBLE_CALLS,
} from "../../site/src/transcripts";
import worker from "../../src/runtimes/worker";
import { TOOLS } from "../../src/server/tools";

const DIR = join(import.meta.dirname, "../../site/transcripts");
const files = readdirSync(DIR).filter((name) => name.endsWith(".json"));
const raw = new Map(files.map((name) => [name, readFileSync(join(DIR, name), "utf8")]));
const committed: Transcript[] = files.map((name) =>
  parseTranscript(JSON.parse(raw.get(name) as string)),
);

beforeEach(() => resetSharedSession());
afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("compareOutputs", () => {
  const output = {
    rows: [
      { segment: "all", p_value: 1.5e-13, significant: true },
      { segment: "new", p_value: 0.0004, significant: true },
    ],
    totals: { orders: 96000, revenue: 13_200_000.5 },
    warnings: [],
    source: "Hillstrom",
  };

  it("matches identical objects", () => {
    expect(compareOutputs(output, structuredClone(output))).toEqual({ matches: true, changed: [] });
  });

  it("returns the path of one changed nested number", () => {
    const live = structuredClone(output);
    (live.rows[1] as { p_value: number }).p_value = 0.0005;
    expect(compareOutputs(output, live)).toEqual({ matches: false, changed: ["rows[1].p_value"] });
  });

  it("tolerates a relative difference of 1e-9, not more", () => {
    const close = structuredClone(output);
    close.totals.revenue *= 1 + 5e-10;
    expect(compareOutputs(output, close).matches).toBe(true);
    const far = structuredClone(output);
    far.totals.revenue *= 1 + 5e-9;
    expect(compareOutputs(output, far).changed).toEqual(["totals.revenue"]);
  });

  it("reports added, removed and retyped fields and longer arrays", () => {
    const live: Record<string, unknown> = structuredClone(output);
    delete live.source;
    live.extra = 1;
    live.warnings = ["new warning"];
    (live.totals as Record<string, unknown>).orders = "96000";
    expect(compareOutputs(output, live).changed.sort()).toEqual(
      ["extra", "source", "totals.orders", "warnings[0]"].sort(),
    );
    expect(compareOutputs([1], {}).changed).toEqual(["$"]);
  });
});

describe("parseTranscript", () => {
  const good = {
    id: "x",
    title: "X",
    lang: "en",
    model: "claude-opus-5-5",
    recorded_at: "2026-10-31",
    server_url: "stdio (local build of this repo)",
    steps: [
      { type: "user", text: "Hi" },
      { type: "tool_call", tool: "ab_test_plan", input: {}, output: { warnings: [] } },
      { type: "assistant", text: "Done" },
    ],
  };

  it("accepts a well-formed transcript", () => {
    expect(parseTranscript(good).steps).toHaveLength(3);
  });

  it.each([
    ["a bad lang", { ...good, lang: "fr" }, /lang/],
    ["a bad date", { ...good, recorded_at: "31/10/2026" }, /recorded_at/],
    ["no steps", { ...good, steps: [] }, /steps/],
    ["an unknown step", { ...good, steps: [{ type: "system", text: "x" }] }, /unknown type/],
    [
      "an extra field",
      { ...good, steps: [{ type: "user", text: "x", cwd: "/home/me" }] },
      /unknown fields/,
    ],
    [
      "a missing output",
      { ...good, steps: [good.steps[0], { type: "tool_call", tool: "t", input: {} }] },
      /output/,
    ],
  ])("rejects %s", (_label, json, message) => {
    expect(() => parseTranscript(json)).toThrow(message);
  });
});

describe("committed transcripts", () => {
  it("are the four the player loads", () => {
    expect(files.map((f) => f.replace(/\.json$/, "")).sort()).toEqual([...TRANSCRIPT_IDS].sort());
  });

  it.each(files)("%s has a matching id, a user question, tool calls and an answer", (name) => {
    const t = committed[files.indexOf(name)] as Transcript;
    expect(t.id).toBe(name.replace(/\.json$/, ""));
    expect(t.steps[0]?.type).toBe("user");
    expect(t.steps.at(-1)?.type).toBe("assistant");
    expect(toolCalls(t).length).toBeGreaterThan(0);
  });

  it("use all nine tools between them", () => {
    const used = new Set(committed.flatMap((t) => toolCalls(t).map((c) => c.tool)));
    expect([...used].sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });

  it.each(files)("%s re-runs in the browser with the recorded outputs", async (name) => {
    const t = committed[files.indexOf(name)] as Transcript;
    const session = await connect("browser", () => {});
    try {
      for (const call of toolCalls(t)) {
        const result = await callTool(session, call.tool, call.input);
        expect(result.isError ?? false, `${call.tool} returned an error`).toBe(false);
        const compared = compareOutputs(call.output, result.structuredContent as object);
        expect(compared, `${call.tool} ${JSON.stringify(call.input)}`).toEqual({
          matches: true,
          changed: [],
        });
      }
    } finally {
      await session.client.close();
    }
  });

  // Nothing from the recording machine may reach a public file.
  const PRIVATE = [
    /C:\\/,
    /C:\\\\/,
    /\/Users\//,
    /\\Users\\/,
    /Marcos/,
    /hotmail/i,
    /bsg/i,
    /AppData/i,
    /session_id/,
    /toolu_/,
    /"cwd"/,
  ];
  it.each(files)("%s holds no local paths, user names or session details", (name) => {
    const text = raw.get(name) as string;
    const strings = JSON.stringify(JSON.parse(text));
    for (const pattern of PRIVATE) {
      expect(pattern.test(text), `${pattern} in ${name}`).toBe(false);
      expect(pattern.test(strings), `${pattern} in ${name} (parsed)`).toBe(false);
    }
  });

  it("load through the player's lazy imports", async () => {
    for (const id of TRANSCRIPT_IDS) {
      const t = await loadTranscript(id);
      expect(t.id).toBe(id);
    }
  });
});

const sample: Transcript = parseTranscript({
  id: "sample",
  title: "Sample",
  lang: "en",
  model: "claude-opus-5-5",
  recorded_at: "2026-10-31",
  server_url: "stdio (local build of this repo)",
  steps: [
    { type: "user", text: "Plan a test" },
    {
      type: "tool_call",
      tool: "ab_test_plan",
      input: { baseline_rate: 0.03, mde_relative: 0.2 },
      output: { per_variant: 13914, warnings: [] },
    },
    {
      type: "tool_call",
      tool: "ab_test_plan",
      input: { baseline_rate: 0.05, mde_relative: 0.2 },
      output: { per_variant: 8000, warnings: [] },
    },
    {
      type: "tool_call",
      tool: "ab_test_plan",
      input: { baseline_rate: 0.1, mde_relative: 0.2 },
      output: { per_variant: 4000, warnings: [] },
    },
    { type: "assistant", text: "You need **13,914** per variant.\n\n## Details\n\n- one\n- two" },
  ],
});

function ok(structuredContent: Record<string, unknown>): CallToolResult {
  return { content: [{ type: "text", text: "summary" }], structuredContent };
}

describe("stampFor", () => {
  it("stamps a match, a difference with its paths, and an error", () => {
    expect(stampFor({ a: 1 }, ok({ a: 1 }))).toEqual({ kind: "match" });
    expect(stampFor({ a: 1, b: 2 }, ok({ a: 1, b: 3 }))).toEqual({
      kind: "differs",
      changed: ["b"],
    });
    expect(stampFor({ a: 1 }, { isError: true, content: [] }).kind).toBe("differs");
  });

  it("clips a long list of changed fields", () => {
    const recorded = Object.fromEntries([..."abcdefg"].map((k) => [k, 1]));
    const live = Object.fromEntries([..."abcdefg"].map((k) => [k, 2]));
    const stamp = stampFor(recorded, ok(live));
    expect(stamp.changed).toHaveLength(MAX_CHANGED + 1);
    expect(stamp.changed?.at(-1)).toBe(`${7 - MAX_CHANGED} more`);
  });
});

describe("recordedTicket", () => {
  it("re-runs the recorded input through the shared runner and stamps the result", async () => {
    const run = vi.fn(async () => ok({ per_variant: 13914, warnings: [] }));
    provideRunner(run, "browser");
    const step = toolCalls(sample)[0];
    if (!step) throw new Error("no step");
    const ticket = recordedTicket(step);
    document.body.append(ticket);
    const button = ticket.querySelector<HTMLButtonElement>(".ticket__run") as HTMLButtonElement;
    expect(button.textContent).toBe(RUN_LABELS.browser.run);
    button.click();
    await vi.waitFor(() => expect(ticket.dataset.stamped).toBe("match"));
    expect(run).toHaveBeenCalledWith("ab_test_plan", step.input);
    expect(ticket.textContent).toContain("Matches recording");
  });

  it("stamps a different output with the changed field", async () => {
    provideRunner(async () => ok({ per_variant: 14000, warnings: [] }), "browser");
    const step = toolCalls(sample)[0];
    if (!step) throw new Error("no step");
    const ticket = recordedTicket(step);
    (ticket.querySelector(".ticket__run") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(ticket.dataset.stamped).toBe("differs"));
    expect(ticket.textContent).toContain("Changed: per_variant");
  });

  it("follows the shared mode on its button", () => {
    const step = toolCalls(sample)[0];
    if (!step) throw new Error("no step");
    const ticket = recordedTicket(step);
    const button = ticket.querySelector(".ticket__run") as HTMLButtonElement;
    setSharedMode("live");
    expect(button.textContent).toBe(RUN_LABELS.live.run);
    setSharedMode("browser");
    expect(button.textContent).toBe(RUN_LABELS.browser.run);
  });

  it("starts the playground when no runner is there yet", async () => {
    const start = vi.fn(() => {
      queueMicrotask(() =>
        provideRunner(async () => ok({ per_variant: 13914, warnings: [] }), "browser"),
      );
    });
    setPlaygroundStarter(start);
    const step = toolCalls(sample)[0];
    if (!step) throw new Error("no step");
    const ticket = recordedTicket(step);
    (ticket.querySelector(".ticket__run") as HTMLButtonElement).click();
    await vi.waitFor(() => expect(ticket.dataset.stamped).toBe("match"));
    expect(start).toHaveBeenCalledOnce();
  });
});

describe("conversation views", () => {
  it("renders the whole conversation and folds long runs of tool calls", () => {
    const list = renderConversation(sample);
    document.body.append(list);
    const tools = [...list.querySelectorAll<HTMLElement>(".chat__item--tool")];
    expect(tools).toHaveLength(3);
    expect(tools.filter((t) => t.hidden)).toHaveLength(3 - VISIBLE_CALLS);
    const more = list.querySelector<HTMLButtonElement>(".chat__item--more button");
    expect(more?.textContent).toBe("Show 1 more tool call");
    more?.click();
    expect(tools.filter((t) => t.hidden)).toHaveLength(0);
    expect(document.activeElement).toBe(tools[VISIBLE_CALLS]?.querySelector(".ticket__run"));
    const answer = list.querySelector(".chat__item--assistant .answer") as HTMLElement;
    expect(answer.querySelector("strong")?.textContent).toBe("13,914");
    expect(answer.querySelector("h4")?.textContent).toBe("Details");
    expect(answer.querySelectorAll("li")).toHaveLength(2);
  });

  it("renders the recorded output on first open of its details", async () => {
    const list = renderConversation(sample);
    const details = list.querySelector<HTMLDetailsElement>(".chat__output") as HTMLDetailsElement;
    details.open = true;
    details.dispatchEvent(new Event("toggle"));
    await vi.waitFor(() =>
      expect(details.querySelector(".chat__output-body")?.childElementCount).toBe(1),
    );
  });

  it("shows a compact hero: question, the first calls, the opening of the answer", () => {
    const items = renderHeroItems(sample);
    expect(items.map((i) => i.className)).toEqual([
      "chat__item chat__item--user",
      ...Array(VISIBLE_CALLS).fill("chat__item chat__item--tool"),
      "chat__item chat__item--assistant",
    ]);
    const answer = items.at(-1) as HTMLElement;
    expect(answer.querySelector(".answer--preview p")?.textContent).toBe(
      "You need 13,914 per variant.",
    );
    // Headings in the preview stay out of the page outline.
    expect(answer.querySelector("h1, h2, h3, h4, h5, h6")).toBeNull();
    expect(answer.querySelector(".md__heading")?.textContent).toBe("Details");
    expect(answer.querySelector(".chat__more")?.textContent).toBe(
      "Plus 1 more tool call. Read the whole conversation",
    );
    expect(answer.querySelector("a")?.getAttribute("href")).toBe("#transcripts");
  });

  it("names the model, the day and where the tools ran", () => {
    expect(footerText(sample)).toBe(
      "Recorded on October 31, 2026 with claude-opus-5-5 in Claude Code · tools ran on stdio (local build of this repo)",
    );
  });
});

describe("transcript tabs", () => {
  it("is a tablist with roving focus and arrow, Home and End keys", () => {
    const second = parseTranscript({ ...sample, id: "second", title: "Second", lang: "es" });
    const root = renderTranscriptTabs([sample, second]);
    document.body.append(root);
    const tabs = [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    const panels = [...root.querySelectorAll<HTMLElement>('[role="tabpanel"]')];
    expect(tabs.map((t) => t.getAttribute("aria-selected"))).toEqual(["true", "false"]);
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1]);
    expect(panels.map((p) => p.hidden)).toEqual([false, true]);
    expect(tabs[1]?.lang).toBe("es");
    expect(panels[0]?.getAttribute("aria-labelledby")).toBe(tabs[0]?.id);
    tabs[0]?.focus();
    tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(tabs[1]);
    expect(panels.map((p) => p.hidden)).toEqual([true, false]);
    tabs[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement).toBe(tabs[0]);
    tabs[0]?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    expect(document.activeElement).toBe(tabs[1]);
    tabs[1]?.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    expect(document.activeElement).toBe(tabs[0]);
    expect(panels[1]?.querySelector(".tr__meta")?.textContent).toContain("claude-opus-5-5");
  });
});

describe("tickets share the playground's client", () => {
  const workerFetch: typeof fetch = (input, init) => worker.fetch(new Request(input, init));

  it("runs a committed call in the browser, then on the live server, logging both", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    await mountPlayground(root, {
      liveUrl: "https://worker.test/mcp",
      live: { fetch: workerFetch },
    });
    const step = toolCalls(committed[0] as Transcript)[0];
    if (!step) throw new Error("no step");
    const ticket = recordedTicket(step);
    document.body.append(ticket);
    const button = ticket.querySelector(".ticket__run") as HTMLButtonElement;
    expect(button.textContent).toBe(RUN_LABELS.browser.run);

    button.click();
    await vi.waitFor(() => expect(ticket.dataset.stamped).toBe("match"));
    const calls = () =>
      [...root.querySelectorAll(".msg__what")].filter((m) =>
        m.textContent?.startsWith(`tools/call ${step.tool}`),
      ).length;
    expect(calls()).toBe(1);

    const live = root.querySelector<HTMLInputElement>('input[value="live"]') as HTMLInputElement;
    live.checked = true;
    live.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(button.textContent).toBe(RUN_LABELS.live.run));
    button.click();
    await vi.waitFor(() => expect(calls()).toBe(2));
    await vi.waitFor(() => expect(ticket.getAttribute("aria-busy")).toBeNull());
    expect(ticket.dataset.stamped).toBe("match");
  });
});
