// ─── HttpMcpClient Streamable HTTP transport compliance ───────────────────────
//
// Exercises `HttpMcpClient` against a local `Bun.serve()` playing a
// spec-compliant (2025-06-18) Streamable HTTP MCP server: it asserts on the
// Accept/Mcp-Session-Id/MCP-Protocol-Version headers the client sends, and on
// the client's ability to parse both `application/json` and
// `text/event-stream` response bodies.

import { describe, expect, test } from "bun:test";
import { HttpMcpClient, parseJsonRpcSseBody } from "../mcp/client.ts";

type FakeServer = ReturnType<typeof Bun.serve>;

interface RecordedRequest {
  method: string;
  accept: string | null;
  sessionId: string | null;
  protocolVersion: string | null;
  body: { method: string; id?: number };
}

function startFakeMcpServer(opts: { respondWithSse: boolean; sessionId?: string }): {
  server: FakeServer;
  url: string;
  requests: RecordedRequest[];
} {
  const requests: RecordedRequest[] = [];
  const server = Bun.serve({
    port: 0,
    async fetch(req) {
      const body = (await req.json()) as { method: string; id?: number };
      requests.push({
        method: req.method,
        accept: req.headers.get("Accept"),
        sessionId: req.headers.get("Mcp-Session-Id"),
        protocolVersion: req.headers.get("MCP-Protocol-Version"),
        body,
      });

      // Notifications (no `id`) get a bare 202, per spec.
      if (body.id === undefined) {
        return new Response(null, { status: 202 });
      }

      const result =
        body.method === "initialize"
          ? { protocolVersion: "2025-06-18", capabilities: {}, serverInfo: { name: "fake", version: "1.0" } }
          : body.method === "tools/list"
            ? { tools: [] }
            : { content: [{ type: "text", text: "ok" }] };
      const rpcResponse = { jsonrpc: "2.0", id: body.id, result };

      const headers: Record<string, string> = {};
      if (opts.sessionId && body.method === "initialize") headers["Mcp-Session-Id"] = opts.sessionId;

      if (opts.respondWithSse) {
        headers["Content-Type"] = "text/event-stream";
        return new Response(`event: message\ndata: ${JSON.stringify(rpcResponse)}\n\n`, { headers });
      }
      headers["Content-Type"] = "application/json";
      return new Response(JSON.stringify(rpcResponse), { headers });
    },
  });
  return { server, url: `http://localhost:${server.port}/mcp`, requests };
}

describe("parseJsonRpcSseBody", () => {
  test("extracts the JSON-RPC response from a single SSE event", () => {
    const body = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 1, result: { ok: true } })}\n\n`;
    expect(parseJsonRpcSseBody(body)).toEqual({ jsonrpc: "2.0", id: 1, result: { ok: true } });
  });

  test("skips unrelated events and returns the first well-formed JSON-RPC response", () => {
    const notification = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "log", params: {} })}\n\n`;
    const response = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: 5, result: "done" })}\n\n`;
    expect(parseJsonRpcSseBody(notification + response)).toEqual({ jsonrpc: "2.0", id: 5, result: "done" });
  });

  test("throws when no JSON-RPC response event is present", () => {
    const notification = `event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", method: "log", params: {} })}\n\n`;
    expect(() => parseJsonRpcSseBody(notification)).toThrow(/No JSON-RPC response found/);
  });
});

describe("HttpMcpClient against a Streamable HTTP server", () => {
  test("sends the dual Accept header and parses a plain application/json response", async () => {
    const { server, url, requests } = startFakeMcpServer({ respondWithSse: false });
    try {
      const client = new HttpMcpClient("fake", { type: "http", url });
      await client.initialize();
      const tools = await client.listTools();
      expect(tools).toEqual([]);
      expect(requests.every((r) => r.accept === "application/json, text/event-stream")).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("parses a text/event-stream response for the JSON-RPC result", async () => {
    const { server, url } = startFakeMcpServer({ respondWithSse: true });
    try {
      const client = new HttpMcpClient("fake", { type: "http", url });
      await client.initialize();
      const result = await client.callTool("noop", {});
      expect(result).toBe("ok");
    } finally {
      server.stop(true);
    }
  });

  test("relays the Mcp-Session-Id from initialize on every subsequent request", async () => {
    const { server, url, requests } = startFakeMcpServer({ respondWithSse: false, sessionId: "sess-123" });
    try {
      const client = new HttpMcpClient("fake", { type: "http", url });
      await client.initialize();
      await client.listTools();

      const initializeReq = requests.find((r) => r.body.method === "initialize");
      const initializedNotif = requests.find((r) => r.body.method === "initialized");
      const listToolsReq = requests.find((r) => r.body.method === "tools/list");

      expect(initializeReq?.sessionId).toBeNull(); // not known yet when the initialize request itself is sent
      expect(initializedNotif?.sessionId).toBe("sess-123");
      expect(listToolsReq?.sessionId).toBe("sess-123");
    } finally {
      server.stop(true);
    }
  });

  test("sends the negotiated MCP-Protocol-Version on requests after initialize", async () => {
    const { server, url, requests } = startFakeMcpServer({ respondWithSse: false });
    try {
      const client = new HttpMcpClient("fake", { type: "http", url });
      await client.initialize();
      await client.listTools();

      const initializeReq = requests.find((r) => r.body.method === "initialize");
      const listToolsReq = requests.find((r) => r.body.method === "tools/list");

      expect(initializeReq?.protocolVersion).toBeNull(); // negotiated version isn't known until the response arrives
      expect(listToolsReq?.protocolVersion).toBe("2025-06-18");
    } finally {
      server.stop(true);
    }
  });
});
