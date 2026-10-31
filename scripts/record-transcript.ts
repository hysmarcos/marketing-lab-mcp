/**
 * Records one conversation with Claude Code and writes it as a transcript for the page.
 *
 *   npx tsx scripts/record-transcript.ts --id email-test --title "..." --lang en \
 *     --prompt-file scripts/prompts/email-test.txt [--mcp-config .cache/mcp-live.json]
 *
 *   npx tsx scripts/record-transcript.ts --from-raw .cache/transcripts-raw/<file>.jsonl ...
 *     converts a stream recorded earlier instead of running Claude again.
 *
 * It runs `claude -p` (the installed CLI, with its own login; no API key is read or passed) in a
 * new empty temporary directory, so no project instructions or skills reach the model. Only the
 * MCP servers in the config load (`--strict-mcp-config`), the built-in tools are off
 * (`--tools ""`), and only this server's tools are allowed. The raw stream goes to
 * `.cache/transcripts-raw/` (gitignored); only the converted transcript is written to
 * `site/transcripts/<id>.json`.
 *
 * The MCP config names one server (default "marketing-lab"). With an `url` the transcript's
 * `server_url` is that URL; with a stdio command it is "stdio (local build of this repo)".
 */
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { toolCalls } from "../site/src/transcript-format";
import { parseStream, streamToTranscript } from "./stream-to-transcript";

const ROOT = resolve(import.meta.dirname, "..");
export const LOCAL_SERVER_NOTE = "stdio (local build of this repo)";

const { values } = parseArgs({
  options: {
    id: { type: "string" },
    title: { type: "string" },
    lang: { type: "string" },
    "prompt-file": { type: "string" },
    "mcp-config": { type: "string", default: join(ROOT, ".cache", "mcp-live.json") },
    server: { type: "string", default: "marketing-lab" },
    "server-url": { type: "string" },
    "from-raw": { type: "string" },
    out: { type: "string" },
    model: { type: "string" },
  },
});

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

const id = values.id ?? fail("--id is required.");
const title = values.title ?? fail("--title is required.");
const lang = values.lang;
if (lang !== "en" && lang !== "es") fail('--lang must be "en" or "es".');
const promptFile = values["prompt-file"] ?? fail("--prompt-file is required.");
const prompt = readFileSync(promptFile, "utf8").trim();
const configPath = resolve(values["mcp-config"]);
const serverName = values.server;

function serverUrlFromConfig(): string {
  const config = JSON.parse(readFileSync(configPath, "utf8")) as {
    mcpServers?: Record<string, { url?: string; command?: string }>;
  };
  const server = config.mcpServers?.[serverName];
  if (!server) fail(`${configPath} has no MCP server named "${serverName}".`);
  if (server.url) return server.url;
  return LOCAL_SERVER_NOTE;
}

function runClaude(rawPath: string): Promise<void> {
  const workdir = mkdtempSync(join(tmpdir(), "transcript-"));
  const args = [
    "-p",
    prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--mcp-config",
    configPath,
    "--strict-mcp-config",
    "--allowedTools",
    `mcp__${serverName}__*`,
    "--tools",
    "",
    "--disable-slash-commands",
    "--setting-sources",
    "project",
    "--no-session-persistence",
  ];
  if (values.model) args.push("--model", values.model);
  console.error(`Recording ${id} with Claude Code (this takes a minute or two)…`);
  return new Promise((done, reject) => {
    const child = spawn("claude", args, { cwd: workdir, stdio: ["ignore", "pipe", "inherit"] });
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      writeFileSync(rawPath, Buffer.concat(chunks));
      rmSync(workdir, { recursive: true, force: true });
      if (code === 0) done();
      else reject(new Error(`claude exited with code ${code}; raw stream in ${rawPath}`));
    });
  });
}

let rawPath = values["from-raw"];
if (!rawPath) {
  const rawDir = join(ROOT, ".cache", "transcripts-raw");
  mkdirSync(rawDir, { recursive: true });
  rawPath = join(rawDir, `${id}-${new Date().toISOString().replace(/[:.]/g, "-")}.jsonl`);
  await runClaude(rawPath);
}

const events = parseStream(readFileSync(rawPath, "utf8"));
// The day of the recording comes from the stream itself, so converting an old stream keeps it.
const stamped = events.find((event) => typeof event.timestamp === "string")?.timestamp;
const recordedAt = new Date(typeof stamped === "string" ? stamped : Date.now()).toISOString();

const transcript = streamToTranscript(events, {
  id,
  title,
  lang,
  prompt,
  serverName,
  serverUrl: values["server-url"] ?? serverUrlFromConfig(),
  recordedAt: recordedAt.slice(0, 10),
});

const out = values.out ?? join(ROOT, "site", "transcripts", `${id}.json`);
mkdirSync(resolve(out, ".."), { recursive: true });
writeFileSync(out, `${JSON.stringify(transcript, null, 2)}\n`);

const tools = toolCalls(transcript).map((call) => call.tool);
console.error(`Wrote ${out}`);
console.error(`Model: ${transcript.model}. Raw stream: ${rawPath}`);
console.error(`Tool calls (${tools.length}): ${tools.join(", ")}`);
const answer = transcript.steps.at(-1);
console.error(`\n${answer?.type === "assistant" ? answer.text : ""}`);
