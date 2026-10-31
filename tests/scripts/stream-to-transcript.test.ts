import { describe, expect, it } from "vitest";
import {
  parseStream,
  streamToTranscript,
  type TranscriptMeta,
} from "../../scripts/stream-to-transcript";

const meta: TranscriptMeta = {
  id: "plan",
  title: "Plan a test",
  lang: "en",
  prompt: "  How many visitors do I need?\n",
  serverUrl: "stdio (local build of this repo)",
  recordedAt: "2026-10-31",
  serverName: "marketing-lab",
};

const output = { per_variant: 13914, total: 27828, days: null, warnings: [], source: "user input" };

// The shapes Claude Code 2.1.296 writes with --output-format stream-json --verbose.
const events = [
  {
    type: "system",
    subtype: "init",
    cwd: "C:\\Users\\someone\\AppData\\Local\\Temp\\transcript-x",
    session_id: "9a4bdec2-2f00-4988-8628-30d0b12bb1cc",
    tools: ["mcp__marketing-lab__ab_test_plan", "mcp__other__secret_tool"],
    mcp_servers: [{ name: "marketing-lab", status: "connected" }],
    model: "claude-opus-5-5",
  },
  { type: "system", subtype: "thinking_tokens", estimated_tokens: 50 },
  {
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: "m1", content: [{ type: "thinking", thinking: "", signature: "x" }] },
  },
  {
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: "m1", content: [{ type: "text", text: "Let me size it." }] },
  },
  {
    type: "assistant",
    parent_tool_use_id: null,
    message: {
      id: "m1",
      content: [
        {
          type: "tool_use",
          id: "toolu_1",
          name: "mcp__marketing-lab__ab_test_plan",
          input: { baseline_rate: 0.03, mde_relative: 0.2 },
        },
      ],
    },
  },
  {
    type: "user",
    parent_tool_use_id: null,
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "toolu_1", content: JSON.stringify(output) }],
    },
    tool_use_result: { content: JSON.stringify(output), structuredContent: output },
  },
  { type: "rate_limit_event", rate_limit_info: { status: "allowed" } },
  {
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: "m2", content: [{ type: "text", text: "You need **13,914** per variant." }] },
  },
  {
    type: "assistant",
    parent_tool_use_id: null,
    message: { id: "m2", content: [{ type: "text", text: "That is 27,828 in total." }] },
  },
  { type: "result", subtype: "success", is_error: false, result: "…", session_id: "9a4b" },
];

const stream = events.map((e) => JSON.stringify(e)).join("\r\n");

describe("streamToTranscript", () => {
  it("keeps the prompt, the text, the tool calls with outputs and the model, nothing else", () => {
    const transcript = streamToTranscript(parseStream(stream), meta);
    expect(transcript).toEqual({
      id: "plan",
      title: "Plan a test",
      lang: "en",
      model: "claude-opus-5-5",
      recorded_at: "2026-10-31",
      server_url: "stdio (local build of this repo)",
      steps: [
        { type: "user", text: "How many visitors do I need?" },
        { type: "assistant", text: "Let me size it." },
        {
          type: "tool_call",
          tool: "ab_test_plan",
          input: { baseline_rate: 0.03, mde_relative: 0.2 },
          output,
        },
        {
          type: "assistant",
          text: "You need **13,914** per variant.\n\nThat is 27,828 in total.",
        },
      ],
    });
    const text = JSON.stringify(transcript);
    for (const leak of ["Users", "AppData", "9a4bdec2", "toolu_", "secret_tool", "other"]) {
      expect(text).not.toContain(leak);
    }
  });

  it("reads the output from the result text when there is no structuredContent", () => {
    const withoutExtra = events.map((e) =>
      e.type === "user" ? { ...e, tool_use_result: undefined } : e,
    );
    const transcript = streamToTranscript(withoutExtra, meta);
    expect(transcript.steps[2]).toMatchObject({ type: "tool_call", output });
  });

  it("skips sub-agent traffic", () => {
    const withSubagent = [
      ...events.slice(0, -1),
      {
        type: "assistant",
        parent_tool_use_id: "toolu_9",
        message: { id: "m9", content: [{ type: "text", text: "inner" }] },
      },
      events.at(-1) as (typeof events)[number],
    ];
    const transcript = streamToTranscript(withSubagent, meta);
    expect(JSON.stringify(transcript)).not.toContain("inner");
  });

  it.each([
    [
      "a tool from another server",
      (list: Record<string, unknown>[]) =>
        list.map((e) =>
          JSON.stringify(e).includes('"tool_use"')
            ? JSON.parse(JSON.stringify(e).replace("mcp__marketing-lab__", "mcp__other__"))
            : e,
        ),
      /not a marketing-lab tool/,
    ],
    [
      "a tool error",
      (list: Record<string, unknown>[]) =>
        list.map((e) =>
          e.type === "user"
            ? {
                type: "user",
                message: {
                  content: [
                    { type: "tool_result", tool_use_id: "toolu_1", content: "bad", is_error: true },
                  ],
                },
              }
            : e,
        ),
      /returned an error/,
    ],
    [
      "a missing result",
      (list: Record<string, unknown>[]) => list.filter((e) => e.type !== "user"),
      /never got a result/,
    ],
    [
      "an unfinished run",
      (list: Record<string, unknown>[]) => list.filter((e) => e.type !== "result"),
      /did not finish/,
    ],
    [
      "a failed run",
      (list: Record<string, unknown>[]) =>
        list.map((e) => (e.type === "result" ? { ...e, is_error: true, result: "limit" } : e)),
      /ended with an error: limit/,
    ],
    [
      "no init event",
      (list: Record<string, unknown>[]) => list.filter((e) => e.subtype !== "init"),
      /no init event/,
    ],
  ])("refuses %s", (_label, change, message) => {
    expect(() => streamToTranscript(change(events), meta)).toThrow(message);
  });
});
