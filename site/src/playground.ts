import "./styles/playground.css";

import type { CallToolResult, Tool } from "@modelcontextprotocol/client";
import { TOOLS } from "../../src/server/tools";
import { LIVE_URL } from "./config";
import {
  argsFromFields,
  buildFields,
  type Field,
  type FormControls,
  FormError,
  fieldsFromSchema,
  type JSONSchema,
  valuesFromArgs,
} from "./forms";
import {
  type ConnectOptions,
  callTool,
  connect,
  LiveUnavailableError,
  listTools,
  type Mode,
  type Session,
  type Traffic,
} from "./mcp";
import { renderResult } from "./render";
import { RUN_LABEL, renderTicket, setTicketRunLabel } from "./ticket";

/**
 * The playground: pick a tool, fill the form generated from its input schema, run it in the page
 * (the real MCP server over an in-memory transport) or on the live Worker, and read the result
 * and the raw JSON-RPC messages.
 */

export const LIVE_FALLBACK_NOTICE =
  "Live server is not responding. Switched back to running in your browser.";
export const LIVE_NOT_DEPLOYED = "The live server is not deployed yet, so the tools run here.";
export const BROWSER_NOTE = "The MCP server runs inside this page. Nothing is sent anywhere.";
export const MAX_LOG = 200;

/** The ticket's run button names where the call will run (Ruling 21). */
export const RUN_LABELS: Record<Mode, { run: string; running: string }> = {
  browser: { run: "Run in your browser", running: "Running in your browser…" },
  live: { run: RUN_LABEL, running: "Running on the live server…" },
};

/** Lines in the message log where the transport changes. */
export const LOG_MARKERS: Record<Mode, string> = {
  browser: "— switched to your browser —",
  live: "— connected to the live server —",
};

function modeName(mode: Mode): string {
  return mode === "live" ? "the live server" : "your browser";
}

/** What failed when a switch of mode fails for a reason other than the live server being down. */
export function switchFailedNotice(mode: Mode, stayed: Mode, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);
  return (
    `Could not switch to ${modeName(mode)}: ${reason}. The tools still run in ${modeName(stayed)}. ` +
    "Try again, or reload the page."
  );
}

export interface PlaygroundState {
  mode: Mode;
  /** Message shown (and announced) above the playground; empty for none. */
  notice: string;
  tool?: string;
  busy: boolean;
}

/** What the playground does when the live server fails: run in the browser again and say so. */
export function onLiveFailure<S extends PlaygroundState>(state: S): S {
  return { ...state, mode: "browser", notice: LIVE_FALLBACK_NOTICE };
}

export interface PlaygroundOptions {
  /** Live endpoint; defaults to `LIVE_URL`. Empty disables the live option. */
  liveUrl?: string;
  /** Passed to `connect("live")` (tests use it to inject a fetch). */
  live?: Omit<ConnectOptions, "url">;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function firstSentence(text: string): [string, string] {
  const match = /^(.+?\.)\s+(.*)$/s.exec(text);
  return match ? [match[1] as string, match[2] as string] : [text, ""];
}

function where(mode: Mode): string {
  return mode === "live" ? "on the live server" : "in your browser";
}

function liveHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** One line per JSON-RPC message: "tools/call ab_test_plan · id 3", "result of tools/call · id 3". */
export function describeMessage(json: unknown, pending: Map<unknown, string>): string {
  if (!isRecord(json)) return "batch";
  const id = "id" in json ? ` · id ${String(json.id)}` : "";
  if (typeof json.method === "string") {
    const params = json.params;
    const tool =
      json.method === "tools/call" && isRecord(params) && typeof params.name === "string"
        ? ` ${params.name}`
        : "";
    return `${json.method}${tool}${id}`;
  }
  const answered = pending.get(json.id);
  const of = answered ? ` of ${answered}` : "";
  if ("error" in json) return `error${of}${id}`;
  return `result${of}${id}`;
}

/** Builds the playground inside `root`, connects the in-page server and lists the tools. */
export async function mountPlayground(
  root: HTMLElement,
  options: PlaygroundOptions = {},
): Promise<void> {
  const liveUrl = options.liveUrl ?? LIVE_URL;
  let state: PlaygroundState = { mode: "browser", notice: "", busy: false };
  let session: Session | undefined;
  let tools: Tool[] = [];
  let fields: Field[] = [];
  let controls: FormControls | undefined;

  // Layout ----------------------------------------------------------------------------------------
  const pg = el("div", "pg");

  const intro = el(
    "p",
    "pg__intro",
    "Pick a tool, fill in the form and run it. You see the answer and every JSON-RPC message " +
      "the client and the server exchange.",
  );

  const modeSet = el("fieldset", "pg__mode");
  modeSet.append(el("legend", "pg__mode-legend", "Where the tools run"));
  const modeNote = el("p", "pg__mode-note");
  modeNote.id = "pg-mode-note";
  const switcher = el("div", "pg__switch");
  const radios = new Map<Mode, HTMLInputElement>();
  for (const [mode, label] of [
    ["browser", "In your browser"],
    ["live", "Live server"],
  ] as const) {
    const option = el("label", "pg__switch-option");
    const radio = el("input");
    radio.type = "radio";
    radio.name = "pg-mode";
    radio.value = mode;
    radio.checked = mode === "browser";
    radio.setAttribute("aria-describedby", modeNote.id);
    if (mode === "live" && !liveUrl) radio.disabled = true;
    radios.set(mode, radio);
    option.append(radio, el("span", "", label));
    switcher.append(option);
  }
  modeSet.append(switcher, modeNote);

  const notice = el("p", "pg__notice");
  notice.setAttribute("role", "alert");

  const grid = el("div", "pg__grid");

  // Tool list
  const toolsBox = el("div", "pg__tools");
  const toolsHeading = el("h3", "pg__heading", "Tools");
  toolsHeading.id = "pg-tools-heading";
  const toolList = el("ul", "pg__tool-list");
  toolList.setAttribute("aria-labelledby", toolsHeading.id);
  toolsBox.append(toolsHeading, toolList);

  // Form
  const form = el("form", "pg__form");
  form.noValidate = true;
  const formTitle = el("h3", "pg__form-title");
  formTitle.id = "pg-form-title";
  form.setAttribute("aria-labelledby", formTitle.id);
  const formLead = el("p", "pg__form-lead");
  const formMore = el("details", "pg__form-more");
  const formMoreText = el("p");
  formMore.append(el("summary", "", "What the model reads"), formMoreText);
  const presets = el("div", "pg__presets");
  const presetsLabel = el("span", "pg__presets-label", "Examples");
  presetsLabel.id = "pg-presets-label";
  const presetButtons = el("div", "pg__preset-buttons");
  presetButtons.setAttribute("role", "group");
  presetButtons.setAttribute("aria-labelledby", presetsLabel.id);
  presets.append(presetsLabel, presetButtons);
  const fieldsSlot = el("div", "pg__fields");
  const formError = el("div", "pg__form-error");
  formError.setAttribute("role", "alert");
  const runButton = el("button", "button pg__run", "Run tool");
  runButton.type = "submit";
  const actions = el("div", "pg__actions");
  actions.append(runButton);
  form.append(formTitle, formLead, formMore, presets, fieldsSlot, formError, actions);

  // Output: status, tabs, panels
  const out = el("div", "pg__out");
  const status = el("p", "pg__status", "Run a tool to see its answer here.");
  status.setAttribute("role", "status");
  const tablist = el("div", "pg__tabs");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", "Output");
  const resultTab = el("button", "pg__tab", "Result");
  const messagesTab = el("button", "pg__tab");
  const messagesCount = el("span", "pg__count", "0");
  messagesTab.append("Messages ", messagesCount);
  const resultPanel = el("div", "pg__panel");
  const messagesPanel = el("div", "pg__panel");
  const tabs: [HTMLButtonElement, HTMLElement, string][] = [
    [resultTab, resultPanel, "result"],
    [messagesTab, messagesPanel, "messages"],
  ];
  for (const [tab, panel, name] of tabs) {
    tab.type = "button";
    tab.id = `pg-tab-${name}`;
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-controls", `pg-panel-${name}`);
    panel.id = `pg-panel-${name}`;
    panel.setAttribute("role", "tabpanel");
    panel.setAttribute("aria-labelledby", tab.id);
    panel.tabIndex = 0;
    tablist.append(tab);
  }
  const ticketSlot = el("div", "pg__ticket");
  const resultSlot = el("div", "pg__result");
  resultPanel.append(ticketSlot, resultSlot);

  const logBar = el("div", "pg__log-bar");
  logBar.append(
    el("p", "pg__log-note", "JSON-RPC messages, newest last."),
    el("button", "button button--small pg__clear", "Clear"),
  );
  const clearButton = logBar.querySelector("button") as HTMLButtonElement;
  clearButton.type = "button";
  const log = el("ol", "pg__log");
  const logEmpty = el("p", "pg__log-empty", "No messages yet.");
  messagesPanel.append(logBar, logEmpty, log);

  out.append(status, tablist, resultPanel, messagesPanel);
  grid.append(toolsBox, form, out);
  pg.append(intro, modeSet, notice, grid);
  root.replaceChildren(pg);

  // Tabs ------------------------------------------------------------------------------------------
  function selectTab(index: number, focus: boolean): void {
    tabs.forEach(([tab, panel], i) => {
      const selected = i === index;
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      panel.hidden = !selected;
      if (selected && focus) tab.focus();
    });
  }
  tabs.forEach(([tab], i) => {
    tab.addEventListener("click", () => selectTab(i, false));
    tab.addEventListener("keydown", (event) => {
      const last = tabs.length - 1;
      const next =
        event.key === "ArrowRight"
          ? i === last
            ? 0
            : i + 1
          : event.key === "ArrowLeft"
            ? i === 0
              ? last
              : i - 1
            : event.key === "Home"
              ? 0
              : event.key === "End"
                ? last
                : undefined;
      if (next === undefined) return;
      event.preventDefault();
      selectTab(next, true);
    });
  });
  selectTab(0, false);

  // Message log -----------------------------------------------------------------------------------
  const pending = new Map<unknown, string>();
  let count = 0;

  /** Appends to the log; follows the newest line only if the reader is already at the bottom. */
  function appendToLog(item: HTMLElement): void {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    log.append(item);
    while (log.childElementCount > MAX_LOG) log.firstElementChild?.remove();
    if (atBottom) log.scrollTop = log.scrollHeight;
    logEmpty.hidden = true;
  }

  function logMarker(mode: Mode): void {
    appendToLog(el("li", "msg-marker", LOG_MARKERS[mode]));
  }

  function onTraffic(message: Traffic): void {
    const json = message.json;
    if (message.direction === "out" && isRecord(json) && typeof json.method === "string") {
      if ("id" in json) pending.set(json.id, json.method);
    }
    const what = describeMessage(json, pending);
    // An answered request no longer needs its method remembered.
    if (message.direction === "in" && isRecord(json) && !("method" in json)) {
      pending.delete(json.id);
    }
    const item = el("li", `msg msg--${message.direction}`);
    const details = el("details", "msg__details");
    const summary = el("summary", "msg__summary");
    summary.append(el("span", "msg__dir", message.direction), el("span", "msg__what", what));
    const text = JSON.stringify(json, null, 2);
    details.open = text.length <= 1200;
    details.append(summary, el("pre", "msg__json", text));
    item.append(details);
    appendToLog(item);
    count += 1;
    messagesCount.textContent = String(count);
  }
  clearButton.addEventListener("click", () => {
    log.replaceChildren();
    count = 0;
    messagesCount.textContent = "0";
    logEmpty.hidden = false;
  });

  // State -----------------------------------------------------------------------------------------
  /** True while a tool call runs (not while switching mode, so keyboard focus stays on the radio). */
  let running = false;

  function render(): void {
    // The alert stays in the DOM; only its text changes, so screen readers announce it reliably.
    if (notice.textContent !== state.notice) notice.textContent = state.notice;
    for (const [mode, radio] of radios) {
      radio.checked = mode === state.mode;
      radio.disabled = running || (mode === "live" && !liveUrl);
    }
    const ticket = ticketSlot.querySelector<HTMLElement>(".ticket");
    if (ticket) {
      setTicketRunLabel(ticket, RUN_LABELS[state.mode].run, RUN_LABELS[state.mode].running);
    }
    modeNote.textContent =
      state.mode === "live"
        ? `Calls go to ${liveHost(liveUrl)} over Streamable HTTP.`
        : liveUrl
          ? BROWSER_NOTE
          : `${BROWSER_NOTE} ${LIVE_NOT_DEPLOYED}`;
    runButton.setAttribute("aria-disabled", String(state.busy));
    runButton.textContent = state.busy ? "Running…" : "Run tool";
    form.setAttribute("aria-busy", String(state.busy));
    for (const button of toolList.querySelectorAll<HTMLButtonElement>("button")) {
      button.setAttribute("aria-pressed", String(button.dataset.tool === state.tool));
    }
  }

  async function useSession(next: Session): Promise<void> {
    const previous = session;
    session = next;
    if (previous && previous !== next) {
      await previous.client.close().catch(() => {});
      // Request ids restart with every session; forget the old session's open requests.
      pending.clear();
    }
  }

  async function fallBackToBrowser(): Promise<void> {
    state = onLiveFailure(state);
    render();
    await useSession(await connect("browser", onTraffic));
    logMarker("browser");
  }

  // Tools and form --------------------------------------------------------------------------------
  function renderToolList(): void {
    toolList.replaceChildren(
      ...tools.map((tool) => {
        const li = el("li");
        const button = el("button", "pg__tool");
        button.type = "button";
        button.dataset.tool = tool.name;
        button.append(
          el("span", "pg__tool-title", tool.title ?? tool.name),
          el("code", "pg__tool-name", tool.name),
        );
        button.addEventListener("click", () => selectTool(tool.name));
        li.append(button);
        return li;
      }),
    );
  }

  function showFormIssues(issues: { path: string; message: string }[]): void {
    controls?.showIssues(issues);
    formError.replaceChildren();
    if (issues.length === 0) return;
    formError.append(
      el(
        "p",
        "",
        issues.length === 1
          ? "One field needs fixing before the tool can run:"
          : `${issues.length} fields need fixing before the tool can run:`,
      ),
    );
    const list = el("ul");
    for (const issue of issues) list.append(el("li", "", issue.message));
    formError.append(list);
  }

  function selectTool(name: string): void {
    const tool = tools.find((t) => t.name === name);
    if (!tool) return;
    state = { ...state, tool: name };
    fields = fieldsFromSchema(tool.inputSchema as JSONSchema);
    controls = buildFields(fields, `pg-${name}`);
    fieldsSlot.replaceChildren(controls.element);
    formTitle.replaceChildren(tool.title ?? name, " ", el("code", "pg__form-name", name));
    const [lead, rest] = firstSentence(tool.description ?? "");
    formLead.textContent = lead;
    formMoreText.textContent = tool.description ?? "";
    formMore.hidden = rest === "";
    const examples = TOOLS.find((spec) => spec.name === name)?.examples ?? [];
    presetButtons.replaceChildren(
      ...examples.map((example) => {
        const button = el("button", "button button--small pg__preset", example.label);
        button.type = "button";
        button.addEventListener("click", () => {
          controls?.write(valuesFromArgs(fields, example.args));
          showFormIssues([]);
        });
        return button;
      }),
    );
    presets.hidden = examples.length === 0;
    const first = examples[0];
    controls.write(valuesFromArgs(fields, first ? first.args : {}));
    showFormIssues([]);
    render();
  }

  // Running ---------------------------------------------------------------------------------------
  function showResult(name: string, result: CallToolResult): void {
    const text = result.content
      .filter((block) => block.type === "text")
      .map((block) => (block as { text: string }).text)
      .join("\n");
    if (result.isError) {
      const box = el("div", "result-error");
      box.setAttribute("role", "alert");
      box.append(
        el(
          "p",
          "result-error__title",
          `${name} returned an error. Change the input and run it again.`,
        ),
        el("p", "result-error__text", text),
      );
      resultSlot.replaceChildren(box);
      status.textContent = `${name} returned an error.`;
      return;
    }
    const structured = isRecord(result.structuredContent) ? result.structuredContent : {};
    resultSlot.replaceChildren(renderResult(name, structured, text));
    // The summary is printed under the ticket; screen readers also hear it with the status.
    status.replaceChildren(
      `${name} ran ${where(state.mode)}.`,
      el("span", "visually-hidden", ` ${text}`),
    );
  }

  function current(): Session {
    if (!session) throw new Error("The playground has no MCP session.");
    return session;
  }

  async function run(name: string, args: Record<string, unknown>, fromTicket: boolean) {
    if (state.busy || !session) return;
    running = true;
    state = { ...state, busy: true, notice: "" };
    if (!fromTicket) {
      ticketSlot.replaceChildren(
        renderTicket({
          tool: name,
          input: args,
          onRun: () => run(name, args, true),
          runLabel: RUN_LABELS[state.mode].run,
          runningLabel: RUN_LABELS[state.mode].running,
        }),
      );
    }
    render();
    status.textContent = `Running ${name} ${where(state.mode)}…`;
    try {
      let result: CallToolResult;
      try {
        result = await callTool(current(), name, args);
      } catch (error) {
        if (!(error instanceof LiveUnavailableError)) throw error;
        await fallBackToBrowser();
        status.textContent = `Running ${name} ${where(state.mode)}…`;
        result = await callTool(current(), name, args);
      }
      showResult(name, result);
    } catch (error) {
      const box = el("div", "result-error");
      box.setAttribute("role", "alert");
      box.append(
        el("p", "result-error__title", "The call failed. Run it again, or reload the page."),
        el("p", "result-error__text", error instanceof Error ? error.message : String(error)),
      );
      resultSlot.replaceChildren(box);
      status.textContent = `${name} failed.`;
    } finally {
      running = false;
      state = { ...state, busy: false };
      render();
    }
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const name = state.tool;
    if (!name || !controls || state.busy) return;
    let args: Record<string, unknown>;
    try {
      args = argsFromFields(fields, controls.read());
    } catch (error) {
      if (!(error instanceof FormError)) throw error;
      showFormIssues(error.issues);
      const first = error.issues[0];
      if (first) controls.control(first.path)?.focus();
      return;
    }
    showFormIssues([]);
    void run(name, args, false);
  });

  /** Rebuilds the tool list and the current form from `tools`, keeping what the visitor typed. */
  function refreshTools(): void {
    const name = state.tool;
    const typed = controls?.read();
    renderToolList();
    const keep = name && tools.some((t) => t.name === name) ? name : tools[0]?.name;
    if (!keep) return;
    selectTool(keep);
    if (keep === name && typed) controls?.write(typed);
  }

  async function switchMode(mode: Mode): Promise<void> {
    if (mode === state.mode || state.busy) {
      render();
      return;
    }
    const stayed = state.mode;
    state = { ...state, busy: true, notice: "" };
    render();
    status.textContent =
      mode === "live" ? "Connecting to the live server…" : "Starting the server in your browser…";
    let next: Session | undefined;
    try {
      next = await connect(mode, onTraffic, { ...options.live, url: liveUrl });
      const listed = await listTools(next);
      await useSession(next);
      tools = listed;
      state = { ...state, mode };
      refreshTools();
      logMarker(mode);
      status.textContent =
        mode === "live" ? "Connected to the live server." : "The tools run in your browser again.";
    } catch (error) {
      // Whatever failed, the new client is dropped and the old session keeps running.
      if (next && next !== session) await next.client.close().catch(() => {});
      state =
        error instanceof LiveUnavailableError && mode === "live"
          ? onLiveFailure(state)
          : { ...state, mode: stayed, notice: switchFailedNotice(mode, stayed, error) };
      status.textContent = "";
    } finally {
      state = { ...state, busy: false };
      render();
    }
  }

  for (const [mode, radio] of radios) {
    radio.addEventListener("change", () => {
      if (radio.checked) void switchMode(mode);
    });
  }

  // Start -----------------------------------------------------------------------------------------
  render();
  session = await connect("browser", onTraffic);
  logMarker("browser");
  tools = await listTools(session);
  renderToolList();
  const first = tools[0];
  if (first) selectTool(first.name);
}
