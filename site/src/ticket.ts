import "./styles/ticket.css";

import { breakAtUnderscores } from "./wbr";

/**
 * The "tool ticket": the one bold element on the page. Every tool call (in the hero, the
 * transcripts and the playground) renders as a ticket. The body is the recording, printed in a
 * tint of ink A; the perforated stub is the live run, printed in ink B. After a live run the
 * ticket gets a rubber stamp that says whether the live answer matches the recording.
 */

export type StampKind = "match" | "differs";

export interface TicketStamp {
  kind: StampKind;
  /** Output fields that changed between the recording and the live run (dotted paths). */
  changed?: string[];
}

export interface TicketOptions {
  tool: string;
  input: Record<string, unknown>;
  /** Runs the call live. Without it the stub button is disabled. */
  onRun?: () => Promise<void>;
  /** Label of the run button. Defaults to "Run it live"; the playground names its mode. */
  runLabel?: string;
  /** Label while the run is in progress. Defaults to "Running…". */
  runningLabel?: string;
  stamp?: TicketStamp;
}

export const STAMP_TEXT: Record<StampKind, string> = {
  match: "Matches recording",
  differs: "Different from recording",
};

export const RUN_LABEL = "Run it live";
export const RUNNING_LABEL = "Running…";
export const NO_RUN_NOTE = "Live runs arrive with the playground";
export const RUN_FAILED_NOTE = "The live run failed. Check your connection and run it again.";

export interface InputRow {
  key: string;
  value: string;
}

const MAX_DEPTH = 2;
const MAX_INLINE_ARRAY = 6;
const MAX_VALUE_CHARS = 48;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPrimitive(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

function clip(text: string): string {
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS - 1)}…` : text;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) {
    if (value.length <= MAX_INLINE_ARRAY && value.every(isPrimitive)) {
      return clip(`[${value.map((v) => JSON.stringify(v)).join(", ")}]`);
    }
    return `${value.length} ${value.length === 1 ? "item" : "items"}`;
  }
  if (value === undefined) return "undefined";
  return clip(JSON.stringify(value));
}

/**
 * Flattens a tool input into the key/value rows printed on the ticket. Nested objects become
 * dotted paths (up to two levels), short arrays of primitives stay inline, long or nested arrays
 * show their length.
 */
export function inputRows(input: Record<string, unknown>, prefix = "", depth = 0): InputRow[] {
  const rows: InputRow[] = [];
  for (const [key, value] of Object.entries(input)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value) && depth < MAX_DEPTH && Object.keys(value).length > 0) {
      rows.push(...inputRows(value, path, depth + 1));
    } else {
      rows.push({ key: path, value: formatValue(value) });
    }
  }
  return rows;
}

let nextId = 0;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderStamp(stamp: TicketStamp): HTMLElement {
  const wrap = el("div", `stamp stamp--${stamp.kind}`);
  wrap.dataset.stamp = stamp.kind;
  wrap.append(el("span", "stamp__ink"));
  const text = el("span", "stamp__text");
  text.append(el("strong", "stamp__title", STAMP_TEXT[stamp.kind]));
  if (stamp.kind === "differs" && stamp.changed && stamp.changed.length > 0) {
    text.append(el("span", "stamp__changed", `Changed: ${stamp.changed.join(", ")}`));
  }
  wrap.append(text);
  return wrap;
}

export function isStampKind(kind: unknown): kind is StampKind {
  return typeof kind === "string" && Object.hasOwn(STAMP_TEXT, kind);
}

/**
 * Adds, replaces or (with `undefined`) removes the stamp on a ticket from `renderTicket`. A stamp
 * with an unknown kind (for example from a malformed transcript file) removes the stamp and logs
 * an error instead of printing a blank one.
 */
export function setTicketStamp(ticket: HTMLElement, stamp: TicketStamp | undefined): void {
  const slot = ticket.querySelector<HTMLElement>(".ticket__stamp-slot");
  if (!slot) throw new Error("setTicketStamp needs an element created by renderTicket.");
  let valid = stamp;
  if (stamp && !isStampKind(stamp.kind)) {
    console.error(`Unknown stamp kind ${JSON.stringify(stamp.kind)}; showing no stamp.`);
    valid = undefined;
  }
  slot.replaceChildren(...(valid ? [renderStamp(valid)] : []));
  if (valid) ticket.dataset.stamped = valid.kind;
  else delete ticket.dataset.stamped;
}

/**
 * Changes the run button's labels on a ticket from `renderTicket` (for example when the
 * playground switches between the browser and the live server). A run in progress keeps its busy
 * label and picks up the new label when it ends.
 */
export function setTicketRunLabel(
  ticket: HTMLElement,
  runLabel: string,
  runningLabel: string = RUNNING_LABEL,
): void {
  const button = ticket.querySelector<HTMLButtonElement>(".ticket__run");
  if (!button) throw new Error("setTicketRunLabel needs an element created by renderTicket.");
  ticket.dataset.runLabel = runLabel;
  ticket.dataset.runningLabel = runningLabel;
  if (ticket.getAttribute("aria-busy") !== "true") button.textContent = runLabel;
}

export function renderTicket(opts: TicketOptions): HTMLElement {
  const id = `ticket-${++nextId}`;
  const ticket = el("article", "ticket");
  ticket.setAttribute("aria-labelledby", `${id}-tool`);

  const body = el("div", "ticket__body");
  body.append(el("p", "ticket__method", "tools/call"));
  // Long names wrap after an underscore ("email_test_" / "analyze"), never inside a word.
  const tool = el("p", "ticket__tool");
  tool.append(breakAtUnderscores(opts.tool));
  tool.id = `${id}-tool`;
  body.append(tool);

  const rows = inputRows(opts.input);
  if (rows.length === 0) {
    body.append(el("p", "ticket__empty", "No arguments"));
  } else {
    const list = el("dl", "ticket__args");
    for (const row of rows) {
      const item = el("div", "ticket__arg");
      item.append(el("dt", "", row.key), el("dd", "", row.value));
      list.append(item);
    }
    body.append(list);
  }

  // Polite live region, so a stamp added after a run is announced.
  const slot = el("div", "ticket__stamp-slot");
  slot.setAttribute("aria-live", "polite");
  body.append(slot);

  const stub = el("div", "ticket__stub");
  const button = el("button", "ticket__run", opts.runLabel ?? RUN_LABEL);
  button.type = "button";
  ticket.dataset.runLabel = opts.runLabel ?? RUN_LABEL;
  ticket.dataset.runningLabel = opts.runningLabel ?? RUNNING_LABEL;
  const note = el("p", "ticket__note");
  note.id = `${id}-note`;
  stub.append(button, note);

  const onRun = opts.onRun;
  if (onRun) {
    button.addEventListener("click", async () => {
      if (ticket.getAttribute("aria-busy") === "true") return;
      ticket.setAttribute("aria-busy", "true");
      button.disabled = true;
      button.textContent = ticket.dataset.runningLabel ?? RUNNING_LABEL;
      note.textContent = "";
      button.removeAttribute("aria-describedby");
      try {
        await onRun();
      } catch {
        note.textContent = RUN_FAILED_NOTE;
        button.setAttribute("aria-describedby", note.id);
      } finally {
        ticket.removeAttribute("aria-busy");
        button.disabled = false;
        button.textContent = ticket.dataset.runLabel ?? RUN_LABEL;
      }
    });
  } else {
    button.disabled = true;
    button.title = NO_RUN_NOTE;
    button.setAttribute("aria-describedby", note.id);
    note.textContent = NO_RUN_NOTE;
  }

  const sheet = el("div", "ticket__sheet");
  sheet.append(body, stub);
  ticket.append(sheet);
  if (opts.stamp) setTicketStamp(ticket, opts.stamp);
  return ticket;
}
