import {
  type Lang,
  parseTranscript,
  type Step,
  type ToolCallStep,
  type Transcript,
} from "../site/src/transcript-format";

/**
 * Converts the event stream of `claude -p --output-format stream-json --verbose` into a
 * transcript. Shapes seen with Claude Code 2.1.296 (one JSON object per line):
 *
 * - `{type:"system", subtype:"init", model, cwd, session_id, tools, mcp_servers, ...}`: only
 *   `model` is kept. Everything else (paths, ids, the client's own tool list) is dropped.
 * - `{type:"system", subtype:"thinking_tokens" | "post_turn_summary" | ...}`, `rate_limit_event`:
 *   ignored.
 * - `{type:"assistant", message:{id, content:[block]}, parent_tool_use_id}`: one content block
 *   per event; consecutive events share `message.id`. Blocks are `thinking` (ignored), `text` and
 *   `tool_use` `{id, name:"mcp__<server>__<tool>", input}`.
 * - `{type:"user", message:{content:[{type:"tool_result", tool_use_id, content, is_error?}]},
 *   tool_use_result:{content, structuredContent, _meta}}`: one result per event. `content` is the
 *   text the model read (for this server, the structured output serialized as JSON).
 * - `{type:"result", subtype:"success", is_error, result, ...}`: the end of the run.
 *
 * Only the user's prompt, the assistant's text and the tool calls with their structured output
 * are written. Anything else in the stream (working directory, session id, usage, other servers)
 * never reaches the file.
 */

export interface TranscriptMeta {
  id: string;
  title: string;
  lang: Lang;
  prompt: string;
  /** Where the tools ran, written as `server_url`. */
  serverUrl: string;
  /** YYYY-MM-DD. */
  recordedAt: string;
  /** MCP server name in the client config; tool names arrive as `mcp__<server>__<tool>`. */
  serverName: string;
}

type Json = Record<string, unknown>;

function isRecord(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Parses a JSON-lines stream, skipping blank lines and anything that is not a JSON object. */
export function parseStream(text: string): Json[] {
  const events: Json[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{")) continue;
    const event: unknown = JSON.parse(trimmed);
    if (isRecord(event)) events.push(event);
  }
  return events;
}

function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((block) => isRecord(block) && block.type === "text")
      .map((block) => String((block as Json).text))
      .join("\n");
  }
  return "";
}

/** The structured output of one tool result block. */
function structuredOutput(block: Json, event: Json, single: boolean): Json {
  const extra = event.tool_use_result;
  if (single && isRecord(extra) && isRecord(extra.structuredContent)) {
    return extra.structuredContent;
  }
  const text = resultText(block.content);
  try {
    const parsed: unknown = JSON.parse(text);
    if (isRecord(parsed)) return parsed;
  } catch {
    // Not JSON: fall through to the error below.
  }
  throw new Error(
    `Tool result ${String(block.tool_use_id)} has no structured output: ${text.slice(0, 200)}`,
  );
}

export function streamToTranscript(events: Json[], meta: TranscriptMeta): Transcript {
  const prefix = `mcp__${meta.serverName}__`;
  const init = events.find((e) => e.type === "system" && e.subtype === "init");
  const model = init?.model;
  if (typeof model !== "string" || model === "") {
    throw new Error("The stream has no init event with a model.");
  }
  const end = events.find((e) => e.type === "result");
  if (!end) throw new Error("The stream has no result event; the run did not finish.");
  if (end.is_error === true) {
    throw new Error(`The run ended with an error: ${String(end.result ?? end.subtype)}`);
  }

  const steps: Step[] = [{ type: "user", text: meta.prompt.trim() }];
  const pending = new Map<string, ToolCallStep>();
  const filled = new Set<string>();

  for (const event of events) {
    // Sub-agent traffic is not part of the conversation the visitor reads.
    if (event.parent_tool_use_id) continue;
    const message = event.message;
    if (!isRecord(message) || !Array.isArray(message.content)) continue;

    if (event.type === "assistant") {
      for (const block of message.content) {
        if (!isRecord(block)) continue;
        if (block.type === "text" && typeof block.text === "string" && block.text.trim()) {
          const last = steps.at(-1);
          if (last?.type === "assistant") last.text = `${last.text}\n\n${block.text.trim()}`;
          else steps.push({ type: "assistant", text: block.text.trim() });
        } else if (block.type === "tool_use") {
          const name = String(block.name);
          if (!name.startsWith(prefix)) {
            throw new Error(`The model used ${name}, which is not a ${meta.serverName} tool.`);
          }
          const step: ToolCallStep = {
            type: "tool_call",
            tool: name.slice(prefix.length),
            input: isRecord(block.input) ? block.input : {},
            output: {},
          };
          pending.set(String(block.id), step);
          steps.push(step);
        }
      }
    } else if (event.type === "user") {
      const results = message.content.filter(
        (block): block is Json => isRecord(block) && block.type === "tool_result",
      );
      for (const block of results) {
        const id = String(block.tool_use_id);
        const step = pending.get(id);
        if (!step) throw new Error(`Tool result ${id} has no matching tool call.`);
        if (block.is_error === true) {
          throw new Error(`${step.tool} returned an error: ${resultText(block.content)}`);
        }
        step.output = structuredOutput(block, event, results.length === 1);
        filled.add(id);
      }
    }
  }

  for (const [id, step] of pending) {
    if (!filled.has(id)) throw new Error(`${step.tool} (${id}) never got a result.`);
  }
  if (steps.at(-1)?.type !== "assistant") {
    throw new Error("The run did not end with an answer from the model.");
  }

  return parseTranscript({
    id: meta.id,
    title: meta.title,
    lang: meta.lang,
    model,
    recorded_at: meta.recordedAt,
    server_url: meta.serverUrl,
    steps,
  });
}
