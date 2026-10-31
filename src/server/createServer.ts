import { McpServer } from "@modelcontextprotocol/server";
import pkg from "../../package.json";
import { MAX_SUMMARY_LENGTH, ToolInputError, type ToolSpec } from "./tool";
import { TOOLS } from "./tools";

function errorResult(message: string) {
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

/**
 * The SDK validates `arguments` against the tool's zod schema before calling the handler, so
 * a schema failure is already returned as `isError` there. Domain errors come from `run`.
 */
function handle(spec: ToolSpec, args: Record<string, unknown>) {
  try {
    const out = spec.run(args);
    const text = spec.summarize(out).slice(0, MAX_SUMMARY_LENGTH);
    return { content: [{ type: "text" as const, text }], structuredContent: out };
  } catch (error) {
    if (error instanceof ToolInputError) return errorResult(error.message);
    throw error;
  }
}

export function createServer(): McpServer {
  const server = new McpServer({ name: "marketing-lab-mcp", version: pkg.version });
  for (const spec of TOOLS) {
    server.registerTool(
      spec.name,
      { title: spec.title, description: spec.description, inputSchema: spec.input },
      (args) => handle(spec, args),
    );
  }
  return server;
}
