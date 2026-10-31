import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { createServer } from "../server/createServer";

// Local mode: the same server over stdin/stdout, for MCP clients that launch a command.
// Never write to stdout here; it carries the protocol.
serveStdio(() => createServer(), {
  onerror: (error) => console.error(error),
});
