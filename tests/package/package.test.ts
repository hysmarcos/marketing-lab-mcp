import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { describe, expect, it } from "vitest";
import pkg from "../../package.json";
import { LIVE_URL, PAGES_URL, REPO_URL } from "../../site/src/config";
import { TOOLS } from "../../src/server/tools";

const ROOT = resolve(import.meta.dirname, "../..");
const server = JSON.parse(readFileSync(resolve(ROOT, "server.json"), "utf8"));

describe("server.json for the MCP Registry", () => {
  it("names the same server and version as package.json", () => {
    expect(server.name).toBe(pkg.mcpName);
    expect(server.version).toBe(pkg.version);
    expect(server.description.length).toBeLessThanOrEqual(100);
  });

  it("lists the npm package and the public URL", () => {
    expect(server.packages).toEqual([
      expect.objectContaining({
        registryType: "npm",
        identifier: pkg.name,
        version: pkg.version,
        transport: { type: "stdio" },
      }),
    ]);
    expect(server.remotes).toEqual([{ type: "streamable-http", url: LIVE_URL }]);
    expect(server.repository.url).toBe(REPO_URL);
    expect(server.websiteUrl).toBe(PAGES_URL);
  });
});

describe("the npm package", () => {
  it("builds a bin that serves every tool over stdio", async () => {
    execSync("npm run build", { cwd: ROOT, stdio: "ignore" });
    const bin = resolve(ROOT, pkg.bin["marketing-lab-mcp"]);
    expect(readFileSync(bin, "utf8").startsWith("#!/usr/bin/env node\n")).toBe(true);

    const client = new Client({ name: "package-test", version: "0.0.0" });
    await client.connect(new StdioClientTransport({ command: process.execPath, args: [bin] }));
    try {
      expect(client.getServerVersion()).toMatchObject({ name: pkg.name, version: pkg.version });
      const { tools } = await client.listTools();
      expect(tools.map((t) => t.name).sort()).toEqual(TOOLS.map((t) => t.name).sort());
      const result = await client.callTool({
        name: "ab_test_plan",
        arguments: { baseline_rate: 0.03, mde_relative: 0.2 },
      });
      expect(result.isError).toBeFalsy();
    } finally {
      await client.close();
    }
  }, 30_000);
});
