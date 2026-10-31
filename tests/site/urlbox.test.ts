// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  COPIED_LABEL,
  COPIED_STATUS,
  COPY_FAILED,
  COPY_FAILED_SHORT,
  wireCopyButton,
} from "../../site/src/copy";
import { setupUrlBox } from "../../site/src/urlbox";

function urlBox(): HTMLElement {
  const root = document.createElement("div");
  root.innerHTML = `
    <output data-urlbox-value>Live URL coming soon</output>
    <button type="button" data-urlbox-copy disabled>Copy URL</button>
    <p id="status" data-urlbox-status>Not deployed yet.</p>`;
  return root;
}

const button = (root: HTMLElement) =>
  root.querySelector<HTMLButtonElement>("[data-urlbox-copy]") as HTMLButtonElement;

function mockClipboard(writeText: (text: string) => Promise<void>) {
  Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
}

afterEach(() => {
  vi.useRealTimers();
});

describe("setupUrlBox", () => {
  it("keeps the coming-soon state with the copy button disabled while the URL is empty", () => {
    const root = urlBox();
    setupUrlBox(root, "");
    expect(root.dataset.state).toBe("empty");
    expect(button(root).disabled).toBe(true);
    expect(button(root).getAttribute("aria-describedby")).toBe("status");
    expect(root.querySelector("[data-urlbox-value]")?.textContent).toBe("Live URL coming soon");
  });

  it("shows the URL and copies it", async () => {
    const writeText = vi.fn(async (_text: string) => {});
    mockClipboard(writeText);
    const root = urlBox();
    setupUrlBox(root, "https://example.workers.dev/mcp");

    expect(root.dataset.state).toBe("ready");
    expect(button(root).disabled).toBe(false);
    expect(button(root).hasAttribute("aria-describedby")).toBe(false);
    expect(root.querySelector("[data-urlbox-value]")?.textContent).toBe(
      "https://example.workers.dev/mcp",
    );
    button(root).click();
    await vi.waitFor(() => expect(button(root).textContent).toBe(COPIED_LABEL));
    expect(writeText).toHaveBeenCalledWith("https://example.workers.dev/mcp");
  });

  it("puts the guidance back in the status line after announcing the copy", async () => {
    vi.useFakeTimers();
    mockClipboard(async () => {});
    const root = urlBox();
    setupUrlBox(root, "https://example.workers.dev/mcp");
    const status = root.querySelector("[data-urlbox-status]");
    const guidance = status?.textContent;
    button(root).click();
    await vi.advanceTimersByTimeAsync(0);
    expect(status?.textContent).toBe(COPIED_STATUS);
    await vi.advanceTimersByTimeAsync(2000);
    expect(button(root).textContent).toBe("Copy URL");
    expect(status?.textContent).toBe(guidance);
  });

  it("throws on incomplete markup", () => {
    expect(() => setupUrlBox(document.createElement("div"), "")).toThrow();
  });
});

describe("wireCopyButton", () => {
  it("goes back to its label after two seconds", async () => {
    vi.useFakeTimers();
    mockClipboard(async () => {});
    const copy = document.createElement("button");
    copy.textContent = "Copy config";
    wireCopyButton(copy, () => "{}");
    copy.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(copy.textContent).toBe(COPIED_LABEL);
    await vi.advanceTimersByTimeAsync(2000);
    expect(copy.textContent).toBe("Copy config");
  });

  it("says what failed and what to do when the clipboard refuses", async () => {
    mockClipboard(() => Promise.reject(new Error("denied")));
    const copy = document.createElement("button");
    copy.textContent = "Copy URL";
    const status = document.createElement("p");
    wireCopyButton(copy, () => "x", { status, failOnButton: false });
    copy.click();
    await vi.waitFor(() => expect(status.textContent).toBe(COPY_FAILED));
    expect(copy.textContent).toBe("Copy URL");
  });

  it("resets the label when a failure follows a success within two seconds", async () => {
    vi.useFakeTimers();
    let refuse = false;
    mockClipboard(() => (refuse ? Promise.reject(new Error("denied")) : Promise.resolve()));
    const copy = document.createElement("button");
    copy.textContent = "Copy URL";
    const status = document.createElement("p");
    wireCopyButton(copy, () => "x", { status, failOnButton: false });
    copy.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(copy.textContent).toBe(COPIED_LABEL);
    refuse = true;
    copy.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(copy.textContent).toBe("Copy URL");
    expect(status.textContent).toBe(COPY_FAILED);
  });

  it("puts the failure on the button when there is no status line", async () => {
    mockClipboard(() => Promise.reject(new Error("denied")));
    const copy = document.createElement("button");
    copy.textContent = "Copy code";
    wireCopyButton(copy, () => "x");
    copy.click();
    await vi.waitFor(() => expect(copy.textContent).toBe(COPY_FAILED_SHORT));
  });

  it("can fail on the button and announce in a hidden status at once", async () => {
    mockClipboard(() => Promise.reject(new Error("denied")));
    const copy = document.createElement("button");
    copy.textContent = "Copy code";
    const status = document.createElement("span");
    wireCopyButton(copy, () => "x", { status, failOnButton: true });
    copy.click();
    await vi.waitFor(() => expect(copy.textContent).toBe(COPY_FAILED_SHORT));
    expect(status.textContent).toBe(COPY_FAILED);
  });
});
