import {
  type CallToolResult,
  Client,
  type FetchLike,
  InMemoryTransport,
  type JSONRPCMessage,
  type MessageExtraInfo,
  ProtocolError,
  StreamableHTTPClientTransport,
  type Tool,
  type Transport,
  type TransportSendOptions,
} from "@modelcontextprotocol/client";
import pkg from "../../package.json";
import { createServer } from "../../src/server/createServer";
import { LIVE_URL } from "./config";

/**
 * The playground's MCP connection. "browser" runs the real server inside the page over an
 * in-memory transport pair; "live" talks to the deployed Worker over Streamable HTTP with the
 * 2026-07-28 flow (`server/discover`, no `initialize`). Every JSON-RPC message in either
 * direction is reported to `onTraffic`, so the page can show the raw protocol.
 */

export type Mode = "browser" | "live";

export interface Traffic {
  direction: "out" | "in";
  json: unknown;
}

export type OnTraffic = (message: Traffic) => void;

export interface Session {
  client: Client;
  mode: Mode;
}

export interface ConnectOptions {
  /** Live endpoint. Defaults to `LIVE_URL`; empty means the server is not deployed. */
  url?: string;
  /** Fetch used by the live transport (tests and local checks). */
  fetch?: FetchLike;
  /** How long the live server may stay silent before the call fails. */
  timeoutMs?: number;
}

/** A live call fails after this long without an answer. */
export const LIVE_TIMEOUT_MS = 10_000;

/** The live server could not be reached, answered with an HTTP error or did not answer in time. */
export class LiveUnavailableError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "LiveUnavailableError";
  }
}

const CLIENT_INFO = { name: "marketing-lab-mcp-playground", version: pkg.version };

/**
 * Wraps a transport so that everything it sends and receives is reported to `onTraffic`. The
 * wrapper owns its own `onmessage`/`onclose`/`onerror` fields, so the client can save and restore
 * them (it does during version negotiation) without a message being logged twice.
 */
export class TappedTransport implements Transport {
  onclose?: () => void;
  onerror?: (error: Error) => void;
  onmessage?: <T extends JSONRPCMessage>(message: T, extra?: MessageExtraInfo) => void;

  constructor(
    private readonly inner: Transport,
    private readonly onTraffic: OnTraffic,
  ) {
    inner.onmessage = (message, extra) => {
      this.onTraffic({ direction: "in", json: message });
      this.onmessage?.(message, extra);
    };
    inner.onclose = () => this.onclose?.();
    inner.onerror = (error) => this.onerror?.(error);
  }

  get sessionId(): string | undefined {
    return this.inner.sessionId;
  }

  get hasPerRequestStream(): boolean | undefined {
    return this.inner.hasPerRequestStream;
  }

  start(): Promise<void> {
    return this.inner.start();
  }

  send(message: JSONRPCMessage, options?: TransportSendOptions): Promise<void> {
    this.onTraffic({ direction: "out", json: message });
    return this.inner.send(message, options);
  }

  close(): Promise<void> {
    return this.inner.close();
  }

  setProtocolVersion(version: string): void {
    this.inner.setProtocolVersion?.(version);
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Settles with `work`, or rejects with `LiveUnavailableError` if it fails for a transport reason
 * or takes longer than `timeoutMs`. A JSON-RPC error from the server (for example an unknown
 * tool) is the server answering, so it is passed through unchanged.
 */
function deadline<T>(work: Promise<T>, timeoutMs: number, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new LiveUnavailableError(`No answer from the live server in ${timeoutMs / 1000} s.`));
    }, timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        if (error instanceof ProtocolError || error instanceof LiveUnavailableError) reject(error);
        else
          reject(
            new LiveUnavailableError(`The live server failed: ${messageOf(error)}`, {
              cause: error,
            }),
          );
      },
    );
  });
}

const timeouts = new WeakMap<Client, number>();

export async function connect(
  mode: Mode,
  onTraffic: OnTraffic,
  options: ConnectOptions = {},
): Promise<Session> {
  if (mode === "browser") {
    const server = createServer();
    const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
    await server.connect(serverEnd);
    const client = new Client(CLIENT_INFO);
    await client.connect(new TappedTransport(clientEnd, onTraffic));
    return { client, mode };
  }

  const url = options.url ?? LIVE_URL;
  if (!url) throw new LiveUnavailableError("The live server is not deployed yet.");
  const timeoutMs = options.timeoutMs ?? LIVE_TIMEOUT_MS;
  const transport = new StreamableHTTPClientTransport(
    new URL(url),
    options.fetch ? { fetch: options.fetch } : {},
  );
  const client = new Client(CLIENT_INFO, { versionNegotiation: { mode: "auto" } });
  const close = () => {
    client.close().catch(() => {});
  };
  try {
    await deadline(client.connect(new TappedTransport(transport, onTraffic)), timeoutMs, close);
  } catch (error) {
    close();
    throw error instanceof LiveUnavailableError
      ? error
      : new LiveUnavailableError(`The live server failed: ${messageOf(error)}`, { cause: error });
  }
  timeouts.set(client, timeoutMs);
  return { client, mode };
}

function guard<T>(session: Session, work: Promise<T>): Promise<T> {
  if (session.mode === "browser") return work;
  return deadline(work, timeouts.get(session.client) ?? LIVE_TIMEOUT_MS);
}

export async function listTools(session: Session): Promise<Tool[]> {
  const { tools } = await guard(session, session.client.listTools());
  return tools;
}

export function callTool(
  session: Session,
  name: string,
  args: Record<string, unknown>,
): Promise<CallToolResult> {
  return guard(
    session,
    session.client.callTool({ name, arguments: args }) as Promise<CallToolResult>,
  );
}
