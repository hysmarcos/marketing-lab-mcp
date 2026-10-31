import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { describe, expect, it } from "vitest";
import worker from "../../src/runtimes/worker";
import { TOOLS } from "../../src/server/tools";

const PAGES_ORIGIN = "https://hysmarcos.github.io";
const LOCAL_ORIGIN = "http://localhost:5173";
const MCP_URL = "https://worker.test/mcp";

/** Runs requests straight through the worker, with no network. */
const workerFetch: typeof fetch = (input, init) => worker.fetch(new Request(input, init));

function mcpPost(headers: Record<string, string> = {}): Request {
  return new Request(MCP_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...headers,
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }),
  });
}

describe("worker", () => {
  it("lists the 9 tools through a real v2 client", async () => {
    const client = new Client({ name: "worker-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), { fetch: workerFetch }),
    );
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(9);
    await client.close();
  });

  it("also serves the 2026-07-28 stateless protocol (server/discover, no initialize)", async () => {
    const client = new Client(
      { name: "worker-test", version: "0.0.0" },
      { versionNegotiation: { mode: "auto" } },
    );
    await client.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), { fetch: workerFetch }),
    );
    const { tools } = await client.listTools();
    expect(tools).toHaveLength(9);
    await client.close();
  });

  it("calls a tool through the worker and gets structured output", async () => {
    const client = new Client({ name: "worker-test", version: "0.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL(MCP_URL), { fetch: workerFetch }),
    );
    const spec = TOOLS[0];
    const example = spec?.examples[0];
    if (!spec || !example) throw new Error("no tool example to call");
    const result = await client.callTool({ name: spec.name, arguments: example.args });
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toEqual(JSON.parse(JSON.stringify(spec.run(example.args))));
    await client.close();
  });

  it("serves a plain-text banner at GET /", async () => {
    const res = await worker.fetch(new Request("https://worker.test/"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toContain("MCP endpoint at /mcp");
    expect(text).toContain("https://hysmarcos.github.io/marketing-lab-mcp/");
  });

  it("answers 404 for unknown paths", async () => {
    const res = await worker.fetch(new Request("https://worker.test/nope"));
    expect(res.status).toBe(404);
    const post = await worker.fetch(
      new Request("https://worker.test/", { method: "POST", body: "{}" }),
    );
    expect(post.status).toBe(404);
  });

  it("rejects an unknown Origin with 403", async () => {
    const res = await worker.fetch(mcpPost({ origin: "https://evil.example" }));
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("rejects an unknown Origin on GET / and on OPTIONS", async () => {
    const get = await worker.fetch(
      new Request("https://worker.test/", { headers: { origin: "https://evil.example" } }),
    );
    expect(get.status).toBe(403);
    const options = await worker.fetch(
      new Request(MCP_URL, { method: "OPTIONS", headers: { origin: "https://evil.example" } }),
    );
    expect(options.status).toBe(403);
  });

  it("allows a request with no Origin (server-to-server clients)", async () => {
    const res = await worker.fetch(mcpPost());
    expect(res.status).toBe(200);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it.each([PAGES_ORIGIN, LOCAL_ORIGIN])(
    "allows %s and echoes it in CORS headers",
    async (origin) => {
      const res = await worker.fetch(mcpPost({ origin }));
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe(origin);
      expect(res.headers.get("vary")).toContain("Origin");
      expect(res.headers.get("access-control-expose-headers")?.toLowerCase()).toContain(
        "mcp-protocol-version",
      );
      // The legacy stateless path answers with a single SSE message event.
      const lines = (await res.text()).split(/\r?\n/);
      const data = lines.find((line) => line.startsWith("data:"));
      expect(JSON.parse(data?.slice(5) ?? "{}").result.tools).toHaveLength(9);
    },
  );

  it("answers the CORS preflight from the Pages origin with 204", async () => {
    const res = await worker.fetch(
      new Request(MCP_URL, {
        method: "OPTIONS",
        headers: {
          origin: PAGES_ORIGIN,
          "access-control-request-method": "POST",
          "access-control-request-headers":
            "content-type, mcp-protocol-version, mcp-method, mcp-name",
        },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(PAGES_ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toBe("POST, GET, DELETE, OPTIONS");
    expect(res.headers.get("access-control-allow-headers")).toBe(
      "content-type, accept, mcp-protocol-version, mcp-method, mcp-name",
    );
    expect(res.headers.get("vary")).toContain("Origin");
  });

  it.each([
    ["a lookalike subdomain", "https://hysmarcos.github.io.evil.com"],
    ["a trailing slash", "https://hysmarcos.github.io/"],
    ["the literal string null", "null"],
  ])("rejects an Origin that is %s with 403", async (_label, origin) => {
    const res = await worker.fetch(mcpPost({ origin }));
    expect(res.status).toBe(403);
    expect(res.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("answers the CORS preflight from localhost:5173 with 204", async () => {
    const res = await worker.fetch(
      new Request(MCP_URL, {
        method: "OPTIONS",
        headers: { origin: LOCAL_ORIGIN, "access-control-request-method": "POST" },
      }),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe(LOCAL_ORIGIN);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("keeps the CORS headers on 404 and 405 so a browser can read the error", async () => {
    const notFound = await worker.fetch(
      new Request("https://worker.test/nope", { headers: { origin: PAGES_ORIGIN } }),
    );
    expect(notFound.status).toBe(404);
    expect(notFound.headers.get("access-control-allow-origin")).toBe(PAGES_ORIGIN);
    for (const method of ["GET", "DELETE"]) {
      const res = await worker.fetch(
        new Request(MCP_URL, { method, headers: { origin: PAGES_ORIGIN } }),
      );
      expect(res.status).toBe(405);
      expect(res.headers.get("access-control-allow-origin")).toBe(PAGES_ORIGIN);
    }
  });

  it("answers GET /mcp with 405 (stateless: no session stream)", async () => {
    const res = await worker.fetch(
      new Request(MCP_URL, { headers: { accept: "text/event-stream" } }),
    );
    expect(res.status).toBe(405);
  });
});
