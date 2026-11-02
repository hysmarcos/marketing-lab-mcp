// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import pkg from "../../package.json";
import {
  apiExample,
  desktopConfig,
  MCP_CONNECTOR_BETA,
  renderConnect,
} from "../../site/src/connect";
import { COPIED_STATUS } from "../../site/src/copy";

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

  it("announces code-block copies in a polite live region", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: async () => {} },
      configurable: true,
    });
    const host = document.createElement("div");
    host.append(renderConnect("", REPO));
    const block = host.querySelector("#connect-local .code") as HTMLElement;
    const status = block.querySelector("[data-copy-status]");
    expect(status?.getAttribute("role")).toBe("status");
    block.querySelector<HTMLButtonElement>("[data-copy]")?.click();
    await vi.waitFor(() => expect(status?.textContent).toBe(COPIED_STATUS));
  });

  it("runs the npm package and links the source for a manual setup", () => {
    const host = document.createElement("div");
    host.append(renderConnect("", REPO));
    const local = host.querySelector("#connect-local");
    expect(local?.querySelector("code")?.textContent).toBe(`npx -y ${pkg.name}`);
    expect(local?.querySelector(`a[href="${REPO}"]`)).not.toBeNull();
  });

  it("uses the newest MCP connector beta and a toolset that matches the server name", () => {
    const code = apiExample("");
    expect(MCP_CONNECTOR_BETA).toBe("mcp-client-2026-09-15");
    expect(code).toContain('betas=["mcp-client-2026-09-15"]');
    expect(code).toContain('"name": "marketing-lab"');
    expect(code).toContain('"mcp_server_name": "marketing-lab"');
  });

  it("gives Claude Desktop valid JSON that launches the npm package", () => {
    const config = JSON.parse(desktopConfig());
    const server = config.mcpServers["marketing-lab"];
    expect(server.command).toBe("npx");
    expect(server.args).toEqual(["-y", pkg.name]);
  });
});
