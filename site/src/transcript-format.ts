/**
 * The recorded-conversation format shared by the recorder (`scripts/record-transcript.ts`), the
 * page's transcript player and the tests. Kept free of DOM and CSS imports so Node can load it.
 */

export type Lang = "en" | "es";

export interface TextStep {
  type: "user" | "assistant";
  text: string;
}

export interface ToolCallStep {
  type: "tool_call";
  /** Tool name without the client's server prefix, for example "email_test_analyze". */
  tool: string;
  input: Record<string, unknown>;
  /** The tool's `structuredContent`, exactly as the model received it. */
  output: Record<string, unknown>;
}

export type Step = TextStep | ToolCallStep;

export interface Transcript {
  id: string;
  title: string;
  lang: Lang;
  /** Model id reported by the client, for example "claude-opus-5-5". */
  model: string;
  /** Day of the recording, YYYY-MM-DD (UTC). */
  recorded_at: string;
  /** Where the tools ran: the public MCP URL, or a note for a local stdio build. */
  server_url: string;
  steps: Step[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function need(condition: unknown, message: string): asserts condition {
  if (!condition) throw new TypeError(message);
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim() !== "";
}

/**
 * Checks that `json` is a transcript and returns it typed. Throws a `TypeError` that names the
 * first field that is wrong, so a broken file fails loudly in tests instead of rendering half.
 */
export function parseTranscript(json: unknown): Transcript {
  need(isRecord(json), "A transcript must be a JSON object.");
  for (const key of ["id", "title", "model", "recorded_at", "server_url"] as const) {
    need(nonEmptyString(json[key]), `Transcript field "${key}" must be a non-empty string.`);
  }
  need(json.lang === "en" || json.lang === "es", 'Transcript field "lang" must be "en" or "es".');
  need(
    /^\d{4}-\d{2}-\d{2}$/.test(json.recorded_at as string),
    'Transcript field "recorded_at" must be a date like 2026-10-31.',
  );
  need(Array.isArray(json.steps) && json.steps.length > 0, "Transcript steps must be a list.");
  (json.steps as unknown[]).forEach((step, i) => {
    const where = `Step ${i}`;
    need(isRecord(step), `${where} must be an object.`);
    if (step.type === "user" || step.type === "assistant") {
      need(nonEmptyString(step.text), `${where} (${step.type}) needs a non-empty text.`);
      need(Object.keys(step).length === 2, `${where} (${step.type}) has unknown fields.`);
      return;
    }
    need(step.type === "tool_call", `${where} has an unknown type ${JSON.stringify(step.type)}.`);
    need(nonEmptyString(step.tool), `${where} (tool_call) needs a tool name.`);
    need(isRecord(step.input), `${where} (tool_call) needs an input object.`);
    need(isRecord(step.output), `${where} (tool_call) needs an output object.`);
    need(Object.keys(step).length === 4, `${where} (tool_call) has unknown fields.`);
  });
  need((json.steps as Step[])[0]?.type === "user", "A transcript starts with the user's message.");
  return json as unknown as Transcript;
}

/** Numbers closer than this, relative to the larger one, count as equal. */
export const RELATIVE_TOLERANCE = 1e-9;

function numbersMatch(a: number, b: number): boolean {
  if (a === b) return true;
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Number.isNaN(a) && Number.isNaN(b);
  return Math.abs(a - b) <= RELATIVE_TOLERANCE * Math.max(Math.abs(a), Math.abs(b));
}

function join(path: string, key: string | number): string {
  if (typeof key === "number") return `${path}[${key}]`;
  return path ? `${path}.${key}` : key;
}

function diff(recorded: unknown, live: unknown, path: string, changed: string[]): void {
  if (typeof recorded === "number" && typeof live === "number") {
    if (!numbersMatch(recorded, live)) changed.push(path || "$");
    return;
  }
  if (Array.isArray(recorded) && Array.isArray(live)) {
    const length = Math.max(recorded.length, live.length);
    for (let i = 0; i < length; i++) {
      if (i >= recorded.length || i >= live.length) changed.push(join(path, i));
      else diff(recorded[i], live[i], join(path, i), changed);
    }
    return;
  }
  if (isRecord(recorded) && isRecord(live)) {
    const keys = new Set([...Object.keys(recorded), ...Object.keys(live)]);
    for (const key of keys) {
      if (!Object.hasOwn(recorded, key) || !Object.hasOwn(live, key)) {
        changed.push(join(path, key));
      } else {
        diff(recorded[key], live[key], join(path, key), changed);
      }
    }
    return;
  }
  if (recorded !== live) changed.push(path || "$");
}

/**
 * Compares a recorded tool output with a fresh run of the same call. Numbers match within a
 * relative tolerance of 1e-9 (the same code on another engine may round the last bit
 * differently); everything else must be equal. `changed` lists the paths that differ, such as
 * `rows[2].p_value`, or `$` when the two values differ at the top.
 */
export function compareOutputs(
  recorded: object,
  live: object,
): { matches: boolean; changed: string[] } {
  const changed: string[] = [];
  diff(recorded, live, "", changed);
  return { matches: changed.length === 0, changed };
}

/** The tool calls of a transcript, in order. */
export function toolCalls(transcript: Transcript): ToolCallStep[] {
  return transcript.steps.filter((step): step is ToolCallStep => step.type === "tool_call");
}
