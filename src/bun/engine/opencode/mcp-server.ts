/**
 * Minimal HTTP MCP server for exposing Railyin tools to OpenCode.
 *
 * OpenCode connects to this server as an MCP client and calls tools
 * (task management, board operations, etc.). Each tool call includes a
 * `conversationId` argument that maps to the active execution context.
 *
 * The server implements JSON-RPC 2.0 over HTTP (stateless POST requests)
 * matching the protocol used by Railyin's own HttpMcpClient.
 */

import type { CommonToolContext } from "../types.ts";
import { COMMON_TOOL_DEFINITIONS, executeCommonTool } from "../common-tools.ts";
import { TodoRepository } from "../../db/todos.ts";
import { DecisionRepository } from "../../db/repositories/decision-repository.ts";

export interface McpContextEntry {
  commonToolContext: CommonToolContext;
}

type ContextMap = Map<number, McpContextEntry>;

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string | null;
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: { code: number; message: string };
}

/** Wrap common tools with an extra `conversationId` parameter injected at the MCP layer. */
const MCP_TOOL_DEFINITIONS = COMMON_TOOL_DEFINITIONS.map((def) => ({
  ...def,
  parameters: {
    ...def.parameters,
    properties: {
      conversationId: {
        type: "number",
        description: "The active conversation ID — always pass this parameter.",
      },
      ...(def.parameters as { properties?: Record<string, unknown> }).properties,
    },
    required: ["conversationId", ...((def.parameters as { required?: string[] }).required ?? [])],
  },
}));

export interface OpenCodeMcpServer {
  url: string;
  close(): void;
}

/**
 * Start a Bun HTTP server that implements the MCP protocol over JSON-RPC/HTTP.
 * The server dispatches tool calls through the contextMap using conversationId.
 */
export function startOpenCodeMcpServer(contextMap: ContextMap): OpenCodeMcpServer {
  const server = Bun.serve({
    port: 0, // random available port
    fetch(req) {
      return handleRequest(req, contextMap);
    },
  });

  return {
    url: `http://localhost:${server.port}/mcp`,
    close: () => server.stop(true),
  };
}

async function handleRequest(req: Request, contextMap: ContextMap): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  let body: JsonRpcRequest;
  try {
    body = (await req.json()) as JsonRpcRequest;
  } catch {
    return jsonRpcError(null, -32700, "Parse error");
  }

  const id = body.id ?? null;

  try {
    switch (body.method) {
      case "initialize":
        return jsonRpcOk(id, {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "railyin", version: "1.0" },
        });

      case "initialized":
        return jsonRpcOk(id, {});

      case "ping":
        return jsonRpcOk(id, {});

      case "tools/list":
        return jsonRpcOk(id, {
          tools: MCP_TOOL_DEFINITIONS.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: t.parameters,
          })),
        });

      case "tools/call": {
        const params = body.params as { name: string; arguments?: Record<string, unknown> } | undefined;
        if (!params?.name) return jsonRpcError(id, -32602, "Invalid params: missing tool name");
        const result = await callTool(params.name, params.arguments ?? {}, contextMap);
        return jsonRpcOk(id, result);
      }

      default:
        return jsonRpcError(id, -32601, `Method not found: ${body.method}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return jsonRpcError(id, -32603, `Internal error: ${message}`);
  }
}

async function callTool(
  name: string,
  args: Record<string, unknown>,
  contextMap: ContextMap,
): Promise<{ content: Array<{ type: "text"; text: string }> }> {
  const conversationId = typeof args.conversationId === "number" ? args.conversationId : null;
  if (conversationId === null) {
    return { content: [{ type: "text", text: "Error: conversationId is required" }] };
  }

  const entry = contextMap.get(conversationId);
  if (!entry) {
    return { content: [{ type: "text", text: `Error: no active execution for conversationId ${conversationId}` }] };
  }

  // Strip the injected conversationId before passing to executeCommonTool
  const { conversationId: _ignored, ...toolArgs } = args;

  const result = await executeCommonTool(name, toolArgs, entry.commonToolContext);
  const text = result.type === "result" ? result.text : `Suspended: ${result.payload}`;
  return { content: [{ type: "text", text }] };
}

function jsonRpcOk(id: number | string | null, result: unknown): Response {
  const body: JsonRpcResponse = { jsonrpc: "2.0", id: id ?? null, result };
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });
}

function jsonRpcError(id: number | string | null | undefined, code: number, message: string): Response {
  const body: JsonRpcResponse = { jsonrpc: "2.0", id: id ?? null, error: { code, message } };
  return new Response(JSON.stringify(body), {
    status: 200, // MCP errors are still 200 HTTP
    headers: { "Content-Type": "application/json" },
  });
}
