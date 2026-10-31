// @vitest-environment happy-dom
import { Client } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LIVE_FALLBACK_NOTICE,
  LOG_MARKERS,
  mountPlayground,
  RUN_LABELS,
} from "../../site/src/playground";
import { sharedRunner } from "../../site/src/session";
import worker from "../../src/runtimes/worker";

const LIVE = "https://worker.test/mcp";

async function mount(options: Parameters<typeof mountPlayground>[1] = {}): Promise<HTMLElement> {
  const root = document.createElement("div");
  document.body.append(root);
  await mountPlayground(root, { liveUrl: "", ...options });
  return root;
}

function q<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const node = root.querySelector<T>(selector);
  if (!node) throw new Error(`missing ${selector}`);
  return node;
}

function toolButton(root: HTMLElement, name: string): HTMLButtonElement {
  return q<HTMLButtonElement>(root, `.pg__tool[data-tool="${name}"]`);
}

function submit(root: HTMLElement): void {
  q<HTMLFormElement>(root, "form.pg__form").requestSubmit();
}

function logLines(root: HTMLElement): string[] {
  return [...root.querySelectorAll(".msg")].map(
    (m) =>
      `${m.querySelector(".msg__dir")?.textContent} ${m.querySelector(".msg__what")?.textContent}`,
  );
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

/** The Worker, straight through, with no network. */
const workerFetch: typeof fetch = (input, init) => worker.fetch(new Request(input, init));

function goLive(root: HTMLElement): void {
  const live = q<HTMLInputElement>(root, 'input[value="live"]');
  live.checked = true;
  live.dispatchEvent(new Event("change"));
}

function ticketButton(root: HTMLElement): HTMLButtonElement {
  return q<HTMLButtonElement>(root, ".pg__ticket .ticket__run");
}

/** Serves the Worker, but answers tools/list with a JSON-RPC error. */
const brokenList: typeof fetch = async (input, init) => {
  const request = new Request(input, init);
  const body = request.method === "POST" ? await request.clone().text() : "";
  const message = body ? JSON.parse(body) : {};
  if (message.method === "tools/list") {
    return new Response(
      JSON.stringify({
        jsonrpc: "2.0",
        id: message.id,
        error: { code: -32603, message: "Tool listing broke" },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  }
  return worker.fetch(request);
};

describe("playground", () => {
  it("lists the nine tools as toggle buttons and loads the first example", async () => {
    const root = await mount();
    const buttons = root.querySelectorAll(".pg__tool");
    expect(buttons).toHaveLength(9);
    expect(toolButton(root, "ab_test_evaluate").getAttribute("aria-pressed")).toBe("true");
    expect(q<HTMLInputElement>(root, "#pg-ab_test_evaluate-control-visitors").value).toBe("21306");
    // Labels are tied to their inputs.
    const label = q<HTMLLabelElement>(root, 'label[for="pg-ab_test_evaluate-control-visitors"]');
    expect(label.textContent).toContain("Visitors");
  });

  it("runs a tool in the browser and logs tools/call out and the result in", async () => {
    const root = await mount();
    toolButton(root, "ab_test_plan").click();
    expect(toolButton(root, "ab_test_plan").getAttribute("aria-pressed")).toBe("true");
    submit(root);
    await vi.waitFor(() => expect(root.querySelector(".result")).not.toBeNull());
    expect(q(root, ".pg__status").textContent).toContain("ab_test_plan ran in your browser.");
    expect(q(root, ".pg__ticket .ticket__tool").textContent).toBe("ab_test_plan");
    const lines = logLines(root);
    expect(lines).toContain("out tools/call ab_test_plan · id 2");
    expect(lines).toContain("in result of tools/call · id 2");
    expect(lines.at(-1)).toBe("in result of tools/call · id 2");

    q<HTMLButtonElement>(root, ".pg__clear").click();
    expect(root.querySelectorAll(".msg")).toHaveLength(0);
    expect(q(root, ".pg__count").textContent).toBe("0");
  });

  it("switches tabs with the arrow keys", async () => {
    const root = await mount();
    const result = q<HTMLButtonElement>(root, "#pg-tab-result");
    const messages = q<HTMLButtonElement>(root, "#pg-tab-messages");
    expect(q(root, "#pg-panel-messages").hidden).toBe(true);
    result.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(messages.getAttribute("aria-selected")).toBe("true");
    expect(document.activeElement).toBe(messages);
    expect(q(root, "#pg-panel-messages").hidden).toBe(false);
    expect(q(root, "#pg-panel-result").hidden).toBe(true);
  });

  it("does not send an empty optional field", async () => {
    const root = await mount();
    toolButton(root, "ab_test_plan").click();
    q<HTMLInputElement>(root, "#pg-ab_test_plan-daily_visitors").value = "";
    submit(root);
    await vi.waitFor(() => expect(root.querySelector(".result")).not.toBeNull());
    const call = [...root.querySelectorAll(".msg--out .msg__json")]
      .map((pre) => JSON.parse(pre.textContent ?? "{}"))
      .find((json) => json.method === "tools/call");
    expect(call.params.arguments).toEqual({ baseline_rate: 0.03, mde_relative: 0.2 });
  });

  it("announces form errors and moves focus to the first wrong field", async () => {
    const root = await mount();
    const visitors = q<HTMLInputElement>(root, "#pg-ab_test_evaluate-control-visitors");
    visitors.value = "lots";
    submit(root);
    const alert = q(root, ".pg__form-error");
    expect(alert.getAttribute("role")).toBe("alert");
    expect(alert.textContent).toContain("Visitors (control) must be a number.");
    expect(visitors.getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(visitors);
    expect(root.querySelector(".result")).toBeNull();
  });

  it("shows a tool error from the server as an alert", async () => {
    const root = await mount();
    toolButton(root, "ab_test_evaluate").click();
    q<HTMLInputElement>(root, "#pg-ab_test_evaluate-control-conversions").value = "999999";
    submit(root);
    await vi.waitFor(() => expect(root.querySelector(".result-error")).not.toBeNull());
    expect(q(root, ".result-error").getAttribute("role")).toBe("alert");
    expect(q(root, ".result-error").textContent).toContain("conversions");
  });

  it("prints what the visitor typed as text in the result and the log", async () => {
    const root = await mount();
    toolButton(root, "store_sales").click();
    const evil = '<img src=x onerror="window.pwned=1">';
    q<HTMLInputElement>(root, "#pg-store_sales-category").value = evil.slice(0, 40);
    submit(root);
    await vi.waitFor(() => expect(root.querySelector(".result")).not.toBeNull());
    expect(root.querySelector("img")).toBeNull();
    expect(root.querySelector(".pg__out")?.textContent).toContain("<img src=x");
  });

  it("disables the live option while there is no live URL", async () => {
    const root = await mount();
    const live = q<HTMLInputElement>(root, 'input[value="live"]');
    expect(live.disabled).toBe(true);
    expect(q(root, "#pg-mode-note").textContent).toContain("not deployed yet");
  });

  it("falls back to the browser with a notice when the live server does not answer", async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    const root = await mount({ liveUrl: LIVE, live: { fetch } });
    const live = q<HTMLInputElement>(root, 'input[value="live"]');
    expect(live.disabled).toBe(false);
    live.checked = true;
    live.dispatchEvent(new Event("change"));
    await vi.waitFor(() => expect(q(root, ".pg__notice").textContent).toBe(LIVE_FALLBACK_NOTICE));
    expect(q(root, ".pg__notice").getAttribute("role")).toBe("alert");
    expect(q<HTMLInputElement>(root, 'input[value="browser"]').checked).toBe(true);
    expect(live.checked).toBe(false);
  });

  it("runs on the live server, and reruns in the browser if it stops answering", async () => {
    let up = true;
    const fetch: typeof globalThis.fetch = (input, init) =>
      up
        ? worker.fetch(new Request(input, init))
        : Promise.reject(new TypeError("Failed to fetch"));
    const root = await mount({ liveUrl: LIVE, live: { fetch } });
    const live = q<HTMLInputElement>(root, 'input[value="live"]');
    live.checked = true;
    live.dispatchEvent(new Event("change"));
    await vi.waitFor(() =>
      expect(q(root, ".pg__status").textContent).toBe("Connected to the live server."),
    );
    expect(logLines(root)).toContain("out server/discover · id server-discover-probe-1");

    toolButton(root, "ab_test_plan").click();
    submit(root);
    await vi.waitFor(() =>
      expect(q(root, ".pg__status").textContent).toContain("ran on the live server"),
    );

    up = false;
    submit(root);
    await vi.waitFor(() =>
      expect(q(root, ".pg__status").textContent).toContain("ran in your browser"),
    );
    expect(q(root, ".pg__notice").textContent).toBe(LIVE_FALLBACK_NOTICE);
    expect(q<HTMLInputElement>(root, 'input[value="browser"]').checked).toBe(true);
  });

  it("names the mode on the ticket's run button and follows mode changes", async () => {
    const root = await mount({ liveUrl: LIVE, live: { fetch: workerFetch } });
    toolButton(root, "ab_test_plan").click();
    submit(root);
    await vi.waitFor(() => expect(root.querySelector(".result")).not.toBeNull());
    expect(ticketButton(root).textContent).toBe(RUN_LABELS.browser.run);
    expect(RUN_LABELS.browser.run).toBe("Run in your browser");

    goLive(root);
    await vi.waitFor(() =>
      expect(q(root, ".pg__status").textContent).toBe("Connected to the live server."),
    );
    expect(ticketButton(root).textContent).toBe("Run it live");

    ticketButton(root).click();
    expect(ticketButton(root).textContent).toBe(RUN_LABELS.live.running);
    await vi.waitFor(() =>
      expect(q(root, ".pg__status").textContent).toContain("ran on the live server"),
    );
    expect(ticketButton(root).textContent).toBe("Run it live");
  });

  it("disables the mode switch while a tool runs", async () => {
    const root = await mount({ liveUrl: LIVE, live: { fetch: workerFetch } });
    const browser = q<HTMLInputElement>(root, 'input[value="browser"]');
    const live = q<HTMLInputElement>(root, 'input[value="live"]');
    submit(root);
    expect(browser.disabled).toBe(true);
    expect(live.disabled).toBe(true);
    await vi.waitFor(() => expect(root.querySelector(".result")).not.toBeNull());
    expect(browser.disabled).toBe(false);
    expect(live.disabled).toBe(false);
  });

  it("disables the mode switch while a transcript ticket runs, so the session cannot be swapped", async () => {
    const root = await mount({ liveUrl: LIVE, live: { fetch: workerFetch } });
    const browser = q<HTMLInputElement>(root, 'input[value="browser"]');
    const live = q<HTMLInputElement>(root, 'input[value="live"]');
    const runShared = await sharedRunner();

    const pending = runShared("ab_test_plan", { baseline_rate: 0.03, mde_relative: 0.2 });
    expect(browser.disabled).toBe(true);
    expect(live.disabled).toBe(true);
    // A switch asked for in the middle of the call does nothing: the radios snap back.
    goLive(root);
    const result = await pending;
    expect(result.isError).toBeFalsy();
    await vi.waitFor(() => expect(live.disabled).toBe(false));
    expect(browser.disabled).toBe(false);
    expect(browser.checked).toBe(true);
    expect(live.checked).toBe(false);
    const markers = [...root.querySelectorAll(".msg-marker")].map((m) => m.textContent);
    expect(markers).toEqual([LOG_MARKERS.browser]);
    // Once the call is over, a switch works again.
    goLive(root);
    await vi.waitFor(() =>
      expect(q(root, ".pg__status").textContent).toBe("Connected to the live server."),
    );
  });

  it("marks transport changes in the message log", async () => {
    const root = await mount({ liveUrl: LIVE, live: { fetch: workerFetch } });
    goLive(root);
    await vi.waitFor(() =>
      expect(q(root, ".pg__status").textContent).toBe("Connected to the live server."),
    );
    const markers = [...root.querySelectorAll(".msg-marker")].map((m) => m.textContent);
    expect(markers).toEqual([LOG_MARKERS.browser, LOG_MARKERS.live]);
    expect(markers[1]).toBe("— connected to the live server —");
  });

  it("rebuilds the tool list from the live server and keeps what was typed", async () => {
    const root = await mount({ liveUrl: LIVE, live: { fetch: workerFetch } });
    toolButton(root, "ab_test_plan").click();
    const before = toolButton(root, "ab_test_plan");
    q<HTMLInputElement>(root, "#pg-ab_test_plan-baseline_rate").value = "0.05";
    goLive(root);
    await vi.waitFor(() =>
      expect(q(root, ".pg__status").textContent).toBe("Connected to the live server."),
    );
    const after = toolButton(root, "ab_test_plan");
    expect(after).not.toBe(before);
    expect(root.querySelectorAll(".pg__tool")).toHaveLength(9);
    expect(after.getAttribute("aria-pressed")).toBe("true");
    expect(q<HTMLInputElement>(root, "#pg-ab_test_plan-baseline_rate").value).toBe("0.05");
  });

  it("stays in the browser and says what failed when the live tools/list returns an error", async () => {
    const close = vi.spyOn(Client.prototype, "close");
    const root = await mount({ liveUrl: LIVE, live: { fetch: brokenList } });
    const notice = q(root, ".pg__notice");
    goLive(root);
    await vi.waitFor(() =>
      expect(notice.textContent).toContain("Could not switch to the live server"),
    );
    expect(notice.textContent).toContain("Tool listing broke");
    expect(notice.textContent).toContain(
      "The tools still run in your browser. Try again, or reload the page.",
    );
    expect(notice.getAttribute("role")).toBe("alert");
    expect(q<HTMLInputElement>(root, 'input[value="browser"]').checked).toBe(true);
    expect(q<HTMLInputElement>(root, 'input[value="live"]').checked).toBe(false);
    expect(q(root, ".pg__status").textContent).not.toContain("Connecting");
    // The client that failed to list the tools is closed; the browser session keeps working.
    expect(close).toHaveBeenCalled();
    toolButton(root, "ab_test_plan").click();
    submit(root);
    await vi.waitFor(() =>
      expect(q(root, ".pg__status").textContent).toContain("ab_test_plan ran in your browser."),
    );
    // Same alert element, emptied by the new run: it stays in the DOM for the next announcement.
    expect(q(root, ".pg__notice")).toBe(notice);
    expect(notice.textContent).toBe("");
  });
});
