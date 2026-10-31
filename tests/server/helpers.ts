import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { createServer } from "../../src/server/createServer";

/** Connects a fresh server and client over a linked in-memory transport pair. */
export async function connectInMemory(): Promise<Client> {
  const server = createServer();
  const [clientEnd, serverEnd] = InMemoryTransport.createLinkedPair();
  await server.connect(serverEnd);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientEnd);
  return client;
}
