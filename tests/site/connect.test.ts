// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { apiExample, desktopConfig, renderConnect } from "../../site/src/connect";

const REPO = "https://github.com/hysmarcos/marketing-lab-mcp";

describe("renderConnect", () => {
  it("has the four blocks, with a copy button per code block", () => {
    const host = document.createElement("div");
    host.append(renderConnect("", REPO));
    expect([...host.querySelectorAll(".connect__title")].map((h) => h.textContent)).toEqual([
      "claude.ai",
      "Claude Desktop",
      "Run it on your machine",
      "For developers: the Claude API",
    ]);
    expect(host.querySelectorAll(".code")).toHaveLength(3);
    expect(host.querySelectorAll(".code [data-copy]")).toHaveLength(3);
    expect(host.querySelector("#connect-local")).not.toBeNull();
  });

  it("puts the live URL in the steps and the API example once it exists", () => {
    const host = document.createElement("div");
    host.append(renderConnect("https://example.workers.dev/mcp", REPO));
    expect(host.querySelector("#connect-claude-ai")?.textContent).toContain(
      "https://example.workers.dev/mcp",
    );
    expect(apiExample("https://example.workers.dev/mcp")).toContain(
      'SERVER_URL = "https://example.workers.dev/mcp"',
    );
  });

  it("uses the MCP connector beta and a toolset that matches the server name", () => {
    const code = apiExample("");
    expect(code).toContain('betas=["mcp-client-2025-11-20"]');
    expect(code).toContain('"name": "marketing-lab"');
    expect(code).toContain('"mcp_server_name": "marketing-lab"');
  });

  it("gives Claude Desktop valid JSON that launches the stdio runtime", () => {
    const config = JSON.parse(desktopConfig());
    const server = config.mcpServers["marketing-lab"];
    expect(server.command).toBe("npx");
    expect(server.args.at(-1)).toMatch(/src\/runtimes\/stdio\.ts$/);
  });
});
