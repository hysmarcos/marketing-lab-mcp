import { createMcpHandler } from "@modelcontextprotocol/server";
import { createServer } from "../server/createServer";

const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  "https://hysmarcos.github.io",
  "http://localhost:5173",
]);

const ROOT_TEXT =
  "marketing-lab-mcp — MCP endpoint at /mcp. Demo and docs: https://hysmarcos.github.io/marketing-lab-mcp/";

/** Response headers a browser client has to be able to read (legacy session id, protocol version). */
const EXPOSED_HEADERS = "mcp-protocol-version, mcp-session-id";

// One handler per isolate: the factory builds a fresh, stateless server for every request.
const mcp = createMcpHandler(() => createServer());

/** Adds CORS headers to a response when the request came from a browser origin. */
function withCors(response: Response, origin: string | null): Response {
  if (origin === null) return response;
  const headers = new Headers(response.headers);
  headers.set("access-control-allow-origin", origin);
  headers.set("access-control-expose-headers", EXPOSED_HEADERS);
  headers.append("vary", "Origin");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function preflight(origin: string | null): Response {
  const headers = new Headers({
    "access-control-allow-methods": "POST, GET, DELETE, OPTIONS",
    "access-control-allow-headers":
      "content-type, accept, mcp-protocol-version, mcp-method, mcp-name",
    "access-control-max-age": "86400",
  });
  return withCors(new Response(null, { status: 204, headers }), origin);
}

export default {
  async fetch(request: Request): Promise<Response> {
    // Requests without an Origin come from servers (claude.ai connects this way), not browsers.
    const origin = request.headers.get("origin");
    if (origin !== null && !ALLOWED_ORIGINS.has(origin)) {
      return new Response("Origin not allowed", { status: 403 });
    }

    const { pathname } = new URL(request.url);
    if (pathname === "/mcp") {
      if (request.method === "OPTIONS") return preflight(origin);
      return withCors(await mcp.fetch(request), origin);
    }
    if (pathname === "/" && (request.method === "GET" || request.method === "HEAD")) {
      return withCors(
        new Response(request.method === "HEAD" ? null : ROOT_TEXT, {
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
        origin,
      );
    }
    return withCors(new Response("Not found", { status: 404 }), origin);
  },
};
