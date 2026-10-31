import "./styles/transcripts.css";

import type { CallToolResult } from "@modelcontextprotocol/client";
import { renderMarkdown } from "./markdown";
import { onSharedModeChange, RUN_LABELS, sharedMode, sharedRunner } from "./session";
import { attachTabInk } from "./tab-ink";
import { renderTicket, setTicketRunLabel, setTicketStamp, type TicketStamp } from "./ticket";
import {
  compareOutputs,
  parseTranscript,
  type Step,
  type TextStep,
  type ToolCallStep,
  type Transcript,
} from "./transcript-format";

/**
 * The transcript player: conversations recorded with Claude Code (`scripts/record-transcript.ts`),
 * shown as the user's message, the tool calls as tickets and Claude's answer. Each ticket re-runs
 * its recorded input through the playground's client (in the browser or on the live server) and
 * is stamped with whether today's output matches the recording.
 */

export const TRANSCRIPT_IDS = ["email-test", "budget", "attribution", "tienda-es"] as const;
export type TranscriptId = (typeof TRANSCRIPT_IDS)[number];

// One chunk per conversation, fetched only when the page needs it.
const LOADERS: Record<TranscriptId, () => Promise<{ default: unknown }>> = {
  "email-test": () => import("../transcripts/email-test.json"),
  budget: () => import("../transcripts/budget.json"),
  attribution: () => import("../transcripts/attribution.json"),
  "tienda-es": () => import("../transcripts/tienda-es.json"),
};

export async function loadTranscript(id: TranscriptId): Promise<Transcript> {
  return parseTranscript((await LOADERS[id]()).default);
}

/** Longest list of changed fields printed on a stamp. */
export const MAX_CHANGED = 4;
/** Tool calls in a row shown before the rest fold behind a button. */
export const VISIBLE_CALLS = 2;

/** The stamp for a re-run: does the output match the recorded one? */
export function stampFor(recorded: Record<string, unknown>, result: CallToolResult): TicketStamp {
  if (result.isError) return { kind: "differs", changed: ["the tool returned an error"] };
  const live = result.structuredContent;
  if (typeof live !== "object" || live === null) {
    return { kind: "differs", changed: ["structuredContent"] };
  }
  const { matches, changed } = compareOutputs(recorded, live);
  if (matches) return { kind: "match" };
  const shown = changed.slice(0, MAX_CHANGED);
  if (changed.length > MAX_CHANGED) shown.push(`${changed.length - MAX_CHANGED} more`);
  return { kind: "differs", changed: shown };
}

/** A ticket for a recorded call whose button re-runs it and stamps the result. */
export function recordedTicket(step: ToolCallStep): HTMLElement {
  const labels = RUN_LABELS[sharedMode()];
  const ticket: HTMLElement = renderTicket({
    tool: step.tool,
    input: step.input,
    runLabel: labels.run,
    runningLabel: labels.running,
    onRun: async () => {
      setTicketStamp(ticket, undefined);
      const run = await sharedRunner();
      const result = await run(step.tool, step.input);
      setTicketStamp(ticket, stampFor(step.output, result));
    },
  });
  // The button names where the call will run, and follows the playground's mode switch.
  onSharedModeChange((mode) => {
    setTicketRunLabel(ticket, RUN_LABELS[mode].run, RUN_LABELS[mode].running);
  });
  return ticket;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className = "",
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * `lang` goes on the words the conversation is written in (the user's bubble and Claude's answer),
 * not on the tickets, labels and footer, which are English interface text.
 */
function userItem(text: string, lang: string): HTMLLIElement {
  const li = el("li", "chat__item chat__item--user");
  const bubble = el("p", "bubble", text);
  bubble.lang = lang;
  li.append(bubble);
  return li;
}

function whoLabel(): HTMLElement {
  return el("p", "chat__who", "Claude");
}

/** The tool's recorded output, rendered on first open (the renderer loads with it). */
function outputDetails(step: ToolCallStep): HTMLDetailsElement {
  const details = el("details", "chat__output");
  details.append(el("summary", "", "What the tool returned"));
  const body = el("div", "chat__output-body");
  details.append(body);
  let rendered = false;
  details.addEventListener("toggle", () => {
    if (!details.open || rendered) return;
    rendered = true;
    import("./render")
      .then(({ renderResult }) => body.replaceChildren(renderResult(step.tool, step.output)))
      .catch(() => {
        const pre = el("pre", "chat__output-json", JSON.stringify(step.output, null, 2));
        body.replaceChildren(pre);
      });
  });
  return details;
}

function callItem(step: ToolCallStep, withOutput: boolean): HTMLLIElement {
  const li = el("li", "chat__item chat__item--tool");
  li.append(recordedTicket(step));
  if (withOutput) li.append(outputDetails(step));
  return li;
}

function plural(n: number, one: string, many: string): string {
  return `${n.toLocaleString("en")} ${n === 1 ? one : many}`;
}

/** Splits the steps into runs: text steps alone, consecutive tool calls together. */
function groups(steps: Step[]): (TextStep | ToolCallStep[])[] {
  const out: (TextStep | ToolCallStep[])[] = [];
  for (const step of steps) {
    const last = out.at(-1);
    if (step.type === "tool_call") {
      if (Array.isArray(last)) last.push(step);
      else out.push([step]);
    } else {
      out.push(step);
    }
  }
  return out;
}

/** The whole conversation, for the transcripts section. */
export function renderConversation(transcript: Transcript): HTMLOListElement {
  const list = el("ol", "chat chat--full");
  for (const group of groups(transcript.steps)) {
    if (Array.isArray(group)) {
      const items = group.map((step) => callItem(step, true));
      const hidden = items.slice(VISIBLE_CALLS);
      list.append(...items.slice(0, VISIBLE_CALLS));
      if (hidden.length > 0) {
        for (const item of hidden) item.hidden = true;
        const more = el("li", "chat__item chat__item--more");
        const button = el(
          "button",
          "button button--small",
          `Show ${plural(hidden.length, "more tool call", "more tool calls")}`,
        );
        button.type = "button";
        button.addEventListener("click", () => {
          for (const item of hidden) item.hidden = false;
          more.remove();
          // Keyboard focus moves to the first call that was hidden.
          hidden[0]?.querySelector<HTMLButtonElement>(".ticket__run")?.focus();
        });
        more.append(button);
        list.append(more, ...hidden);
      }
    } else if (group.type === "user") {
      list.append(userItem(group.text, transcript.lang));
    } else {
      const li = el("li", "chat__item chat__item--assistant");
      const answer = el("div", "answer");
      answer.lang = transcript.lang;
      answer.append(renderMarkdown(group.text));
      li.append(whoLabel(), answer);
      list.append(li);
    }
  }
  return list;
}

/**
 * The hero's compact view of a conversation: the question, the first tool calls, and the opening
 * of the final answer (cut at a fixed height) with a link to the whole transcript. One list item per message, so the
 * page can reveal them one by one.
 */
export function renderHeroItems(
  transcript: Transcript,
  fullHref = "#transcripts",
): HTMLLIElement[] {
  const items: HTMLLIElement[] = [];
  const first = transcript.steps[0];
  if (first?.type === "user") items.push(userItem(first.text, transcript.lang));
  const calls = transcript.steps.filter((s): s is ToolCallStep => s.type === "tool_call");
  for (const step of calls.slice(0, VISIBLE_CALLS)) items.push(callItem(step, false));
  const answerStep = transcript.steps.findLast((s): s is TextStep => s.type === "assistant");
  const li = el("li", "chat__item chat__item--assistant");
  li.append(whoLabel());
  // The opening of the answer, faded out at a fixed height; the whole text is one link away.
  const preview = el("div", "answer answer--preview");
  preview.lang = transcript.lang;
  preview.append(renderMarkdown(answerStep?.text ?? "", { plainHeadings: true }));
  // Tables cut off by the fade are not keyboard stops here; the full view has them.
  for (const table of preview.querySelectorAll<HTMLElement>(".md__table")) {
    table.removeAttribute("tabindex");
    table.removeAttribute("role");
    table.removeAttribute("aria-label");
  }
  const more = calls.length - VISIBLE_CALLS;
  const link = el("a", "chat__more-link", "Read the whole conversation");
  link.href = fullHref;
  const note = el(
    "p",
    "chat__more",
    more > 0 ? `Plus ${plural(more, "more tool call", "more tool calls")}. ` : "",
  );
  note.append(link);
  li.append(preview, note);
  items.push(li);
  return items;
}

const DATE = new Intl.DateTimeFormat("en", { dateStyle: "long", timeZone: "UTC" });

/** "Recorded on October 31, 2026 with claude-opus-5-5 · tools: stdio (local build of this repo)". */
export function footerText(transcript: Transcript): string {
  const day = DATE.format(new Date(`${transcript.recorded_at}T00:00:00Z`));
  return `Recorded on ${day} with ${transcript.model} in Claude Code · tools ran on ${transcript.server_url}`;
}

/** Builds the transcripts section: a tablist with one tab and one panel per conversation. */
export function renderTranscriptTabs(transcripts: Transcript[]): HTMLElement {
  const wrap = el("div", "tr");
  const tablist = el("div", "tr__tabs");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Recorded conversations");
  const tabs: HTMLButtonElement[] = [];
  const panels: HTMLElement[] = [];

  for (const transcript of transcripts) {
    const tab = el("button", "tr__tab", transcript.title);
    tab.type = "button";
    tab.id = `tr-tab-${transcript.id}`;
    tab.lang = transcript.lang;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `tr-panel-${transcript.id}`);
    const panel = el("div", "tr__panel");
    panel.id = `tr-panel-${transcript.id}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    panel.tabIndex = 0;
    const footer = el("p", "tr__meta", footerText(transcript));
    footer.lang = "en";
    panel.append(renderConversation(transcript), footer);
    tabs.push(tab);
    panels.push(panel);
    tablist.append(tab);
  }

  const ink = attachTabInk(tablist);
  function select(index: number, focus: boolean): void {
    tabs.forEach((tab, i) => {
      const selected = i === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      (panels[i] as HTMLElement).hidden = !selected;
      if (selected && focus) tab.focus();
    });
    ink.update();
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener("click", () => select(i, false));
    tab.addEventListener("keydown", (event) => {
      const last = tabs.length - 1;
      const keys: Record<string, number> = {
        ArrowRight: i === last ? 0 : i + 1,
        ArrowLeft: i === 0 ? last : i - 1,
        Home: 0,
        End: last,
      };
      const next = keys[event.key];
      if (next === undefined) return;
      event.preventDefault();
      select(next, true);
    });
  });
  select(0, false);

  wrap.append(tablist, ...panels);
  return wrap;
}

export const TRANSCRIPTS_INTRO =
  "Real conversations recorded with Claude Code: Claude read the question, picked the tools on " +
  "its own and answered from what they returned. Run any tool call again; the stamp says " +
  "whether today's answer matches the recording.";

/** Loads every transcript and fills the transcripts section. */
export async function mountTranscripts(root: HTMLElement): Promise<void> {
  const transcripts = await Promise.all(TRANSCRIPT_IDS.map(loadTranscript));
  root.replaceChildren(el("p", "tr__intro", TRANSCRIPTS_INTRO), renderTranscriptTabs(transcripts));
}
