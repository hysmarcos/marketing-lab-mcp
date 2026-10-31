import type { CallToolResult } from "@modelcontextprotocol/client";
import type { Mode } from "./mcp";

/**
 * The page's one MCP connection, shared by the playground and the transcript player. The
 * playground owns the client (in the browser or on the live server) and registers a runner here;
 * a transcript ticket asks for that runner, so a re-run goes through the same client, shows up in
 * the playground's message log and falls back to the browser the same way. This module has no
 * runtime imports, so the hero can use it without loading the SDK.
 */

export type ToolRunner = (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;

/** The ticket's run button names where the call will run (Ruling 21). */
export const RUN_LABELS: Record<Mode, { run: string; running: string }> = {
  browser: { run: "Run in your browser", running: "Running in your browser…" },
  live: { run: "Run it live", running: "Running on the live server…" },
};

let mode: Mode = "browser";
let runner: ToolRunner | undefined;
let starter: (() => void) | undefined;
let failure: unknown;
const waiting: { resolve: (run: ToolRunner) => void; reject: (error: unknown) => void }[] = [];
const listeners = new Set<(mode: Mode) => void>();

/** Where tool calls run right now. */
export function sharedMode(): Mode {
  return mode;
}

/** Calls `listener` whenever the mode changes. Returns a function that stops it. */
export function onSharedModeChange(listener: (mode: Mode) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The playground reports its mode after every switch or fallback. */
export function setSharedMode(next: Mode): void {
  if (next === mode) return;
  mode = next;
  for (const listener of listeners) listener(mode);
}

/** The playground registers how to run a tool once its client is connected. */
export function provideRunner(run: ToolRunner, current: Mode): void {
  runner = run;
  failure = undefined;
  setSharedMode(current);
  for (const { resolve } of waiting.splice(0)) resolve(run);
}

/** The page reports that the playground could not start; waiting and later runs reject. */
export function runnerUnavailable(error: unknown): void {
  failure = error;
  for (const { reject } of waiting.splice(0)) reject(error);
}

/** The page registers how to start the playground, so a ticket click can start it early. */
export function setPlaygroundStarter(start: () => void): void {
  starter = start;
}

/** Starts loading the playground now (for example when a part of the page will need it soon). */
export function startPlayground(): void {
  starter?.();
}

/** The runner, once the playground has connected; starts the playground if it has not yet. */
export function sharedRunner(): Promise<ToolRunner> {
  if (runner) return Promise.resolve(runner);
  if (failure !== undefined) return Promise.reject(failure);
  const pending = new Promise<ToolRunner>((resolve, reject) => waiting.push({ resolve, reject }));
  starter?.();
  return pending;
}

/** Test helper: forgets the runner, the starter, the listeners and the mode. */
export function resetSharedSession(): void {
  mode = "browser";
  runner = undefined;
  starter = undefined;
  failure = undefined;
  waiting.length = 0;
  listeners.clear();
}
