// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  callTool,
  connect,
  LIVE_TIMEOUT_MS,
  LiveUnavailableError,
  listTools,
  type Traffic,
} from "../../site/src/mcp";
import { LIVE_FALLBACK_NOTICE, onLiveFailure } from "../../site/src/playground";
import worker from "../../src/runtimes/worker";

const LIVE = "https://worker.test/mcp";

/** Runs requests straight through the Worker, with no network. */
const workerFetch: typeof fetch = (input, init) => worker.fetch(new Request(input, init));

function methodsOf(log: Traffic[], direction: "out" | "in"): string[] {
  return log
    .filter((m) => m.direction === direction)
    .map((m) => (m.json as { method?: string }).method ?? "response");
}

afterEach(() => {
  vi.useRealTimers();
});

describe("connect('browser')", () => {
  it("runs the real server in the page and logs every JSON-RPC message", async () => {
    const log: Traffic[] = [];
    const session = await connect("browser", (m) => log.push(m));
    expect(session.mode).toBe("browser");
    const tools = await listTools(session);
    expect(tools).toHaveLength(9);
    expect(methodsOf(log, "out")).toEqual([
      "initialize",
      "notifications/initialized",
      "tools/list",
    ]);

    log.length = 0;
    const result = await callTool(session, "ab_test_plan", {
      baseline_rate: 0.03,
      mde_relative: 0.2,
    });
    expect(result.isError).toBeFalsy();
    const [out, back] = log;
    expect(out?.direction).toBe("out");
    expect(out?.json).toMatchObject({
      method: "tools/call",
      params: { name: "ab_test_plan", arguments: { baseline_rate: 0.03, mde_relative: 0.2 } },
    });
    expect(back?.direction).toBe("in");
    const id = (out?.json as { id?: number } | undefined)?.id;
    expect(typeof id).toBe("number");
    expect(back?.json).toMatchObject({ id, result: { structuredContent: { per_variant: 13914 } } });
    await session.client.close();
  });
});

describe("connect('live')", () => {
  it("talks to the Worker with the 2026-07-28 flow (server/discover, no initialize)", async () => {
    const log: Traffic[] = [];
    const session = await connect("live", (m) => log.push(m), { url: LIVE, fetch: workerFetch });
    expect(session.mode).toBe("live");
    expect(await listTools(session)).toHaveLength(9);
    expect(methodsOf(log, "out")).toEqual(["server/discover", "tools/list"]);
    const result = await callTool(session, "ab_test_plan", {
      baseline_rate: 0.03,
      mde_relative: 0.2,
    });
    expect(result.structuredContent).toMatchObject({ per_variant: 13914 });
    expect(methodsOf(log, "in").length).toBeGreaterThanOrEqual(3);
    await session.client.close();
  });

  it("fails with LiveUnavailableError while there is no live URL", async () => {
    await expect(connect("live", () => {}, { url: "" })).rejects.toBeInstanceOf(
      LiveUnavailableError,
    );
  });

  it("fails with LiveUnavailableError when the network request rejects", async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError("Failed to fetch")));
    await expect(connect("live", () => {}, { url: LIVE, fetch })).rejects.toBeInstanceOf(
      LiveUnavailableError,
    );
    expect(fetch).toHaveBeenCalled();
  });

  it("fails with LiveUnavailableError on a non-2xx answer", async () => {
    const fetch = async () => new Response("Service unavailable", { status: 503 });
    await expect(connect("live", () => {}, { url: LIVE, fetch })).rejects.toBeInstanceOf(
      LiveUnavailableError,
    );
  });

  it("fails with LiveUnavailableError after 10 seconds without an answer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const fetch = () => new Promise<Response>(() => {});
    const pending = connect("live", () => {}, { url: LIVE, fetch });
    const settled = expect(pending).rejects.toBeInstanceOf(LiveUnavailableError);
    await vi.advanceTimersByTimeAsync(LIVE_TIMEOUT_MS - 1);
    let done = false;
    pending.catch(() => {
      done = true;
    });
    await Promise.resolve();
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await settled;
    expect(LIVE_TIMEOUT_MS).toBe(10_000);
  });

  it("turns a network failure during a tool call into LiveUnavailableError", async () => {
    let up = true;
    const fetch: typeof globalThis.fetch = (input, init) =>
      up ? workerFetch(input, init) : Promise.reject(new TypeError("Failed to fetch"));
    const session = await connect("live", () => {}, { url: LIVE, fetch });
    up = false;
    await expect(
      callTool(session, "ab_test_plan", { baseline_rate: 0.03, mde_relative: 0.2 }),
    ).rejects.toBeInstanceOf(LiveUnavailableError);
    await session.client.close();
  });
});

describe("onLiveFailure", () => {
  it("switches back to the browser and says so", () => {
    const next = onLiveFailure({ mode: "live", notice: "", tool: "ab_test_plan", busy: true });
    expect(next).toEqual({
      mode: "browser",
      notice: "Live server is not responding. Switched back to running in your browser.",
      tool: "ab_test_plan",
      busy: true,
    });
    expect(LIVE_FALLBACK_NOTICE).toBe(next.notice);
  });
});
