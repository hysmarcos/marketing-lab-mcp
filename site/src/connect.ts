import { wireCopyButton } from "./copy";

/**
 * "Connect to your Claude": four static blocks. Menu names were checked on 2026-10-31 against
 * https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp
 * (custom connectors), https://modelcontextprotocol.io/docs/develop/connect-local-servers
 * (Claude Desktop config) and https://platform.claude.com/docs/en/agents-and-tools/mcp-connector
 * (Claude API MCP connector).
 */

export const CONNECTORS_GUIDE_URL =
  "https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp";
export const LOCAL_SERVERS_GUIDE_URL =
  "https://modelcontextprotocol.io/docs/develop/connect-local-servers";
export const MCP_CONNECTOR_DOCS_URL =
  "https://platform.claude.com/docs/en/agents-and-tools/mcp-connector";
export const MCP_CONNECTOR_BETA = "mcp-client-2025-11-20";

const escapeHtml = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c,
  );

export function localCommands(repoUrl: string): string {
  return [`git clone ${repoUrl}.git`, "cd marketing-lab-mcp", "npm ci", "npm run start:stdio"].join(
    "\n",
  );
}

export function desktopConfig(): string {
  return JSON.stringify(
    {
      mcpServers: {
        "marketing-lab": {
          command: "npx",
          args: ["-y", "tsx", "/ABSOLUTE/PATH/TO/marketing-lab-mcp/src/runtimes/stdio.ts"],
        },
      },
    },
    null,
    2,
  );
}

export function apiExample(liveUrl: string): string {
  const urlLine = liveUrl
    ? `SERVER_URL = ${JSON.stringify(liveUrl)}`
    : `SERVER_URL = ""  # the live URL is coming soon`;
  return `import anthropic

${urlLine}

client = anthropic.Anthropic()  # reads ANTHROPIC_API_KEY
response = client.beta.messages.create(
    model="claude-sonnet-5-5",
    max_tokens=1024,
    betas=["${MCP_CONNECTOR_BETA}"],
    mcp_servers=[{
        "type": "url",
        "url": SERVER_URL,
        "name": "marketing-lab",
    }],
    tools=[{
        "type": "mcp_toolset",
        "mcp_server_name": "marketing-lab",
    }],
    messages=[{
        "role": "user",
        "content": "Control: 500 of 10,000 converted. "
                   "Variant: 570 of 10,000. Did it win?",
    }],
)
print(response.content[-1].text)`;
}

function codeBlock(label: string, copyLabel: string, code: string): string {
  return `<div class="code">
  <div class="code__head"><span>${escapeHtml(label)}</span><button class="button button--small" type="button" data-copy>${escapeHtml(copyLabel)}</button></div>
  <pre><code>${escapeHtml(code)}</code></pre>
</div>`;
}

/** Builds the section body. `liveUrl` may be empty while the Worker is not deployed. */
export function renderConnect(liveUrl: string, repoUrl: string): DocumentFragment {
  const urlStep = liveUrl
    ? `Name it <code>marketing-lab</code>, paste <code>${escapeHtml(liveUrl)}</code> and click <b>Continue</b>.`
    : "Name it <code>marketing-lab</code>, paste the server URL from the top of this page and click <b>Continue</b>.";

  const html = `
<p class="connect__intro">The server speaks MCP over HTTP and needs no account or key, so any Claude that accepts a connector URL can use it.</p>
<ol class="connect">
  <li class="connect__block" id="connect-claude-ai">
    <h3 class="connect__title">claude.ai</h3>
    <ol class="connect__steps">
      <li>Open <b>Customize → Connectors</b>.</li>
      <li>Click <b>+ Add</b>, then <b>Add custom connector</b>.</li>
      <li>${urlStep}</li>
      <li>Click <b>Continue</b> again, choose <b>No sign in</b> and click <b>Add</b>.</li>
    </ol>
    <p class="connect__aside">Works on the free plan, which allows one custom connector. Steps from <a href="${CONNECTORS_GUIDE_URL}">Anthropic's connector guide</a>.</p>
  </li>
  <li class="connect__block" id="connect-desktop">
    <h3 class="connect__title">Claude Desktop</h3>
    <p>Same steps, same menu: <b>Customize → Connectors → + Add → Add custom connector</b>.</p>
    <p class="connect__aside">Desktop routes remote connectors through your Claude account, so the server is reached from Anthropic's cloud, not from your computer.</p>
  </li>
  <li class="connect__block" id="connect-local">
    <h3 class="connect__title">Run it on your machine</h3>
    <p>Needs git and Node.js 24. The last command starts the server over stdio and waits quietly for a client; stop it with Ctrl+C.</p>
    ${codeBlock("Terminal", "Copy commands", localCommands(repoUrl))}
    <p>To let Claude Desktop start it for you, open <b>Settings → Developer → Edit Config</b>, add this with the absolute path to your clone, then quit and reopen Desktop.</p>
    ${codeBlock("claude_desktop_config.json", "Copy config", desktopConfig())}
    <p class="connect__aside">More on local servers in the <a href="${LOCAL_SERVERS_GUIDE_URL}">MCP guide</a>.</p>
  </li>
  <li class="connect__block" id="connect-api">
    <h3 class="connect__title">For developers: the Claude API</h3>
    <p>The Messages API can call a remote MCP server for you through the MCP connector (beta header <code>${MCP_CONNECTOR_BETA}</code>). It runs on your own API key and bills your account; this page never asks for one.</p>
    ${codeBlock("Python", "Copy code", apiExample(liveUrl))}
    <p class="connect__aside">Read the <a href="${MCP_CONNECTOR_DOCS_URL}">MCP connector docs</a> for auth, tool filters and other SDKs.</p>
  </li>
</ol>`;

  const template = document.createElement("template");
  template.innerHTML = html;
  const fragment = template.content;
  for (const button of fragment.querySelectorAll<HTMLButtonElement>("[data-copy]")) {
    const code = button.closest(".code")?.querySelector("code");
    if (code) wireCopyButton(button, () => code.textContent ?? "");
  }
  return fragment;
}
