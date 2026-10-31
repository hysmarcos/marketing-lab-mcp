// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { LIVE_FALLBACK_NOTICE, mountPlayground } from "../../site/src/playground";
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
});

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
});
