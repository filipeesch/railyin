/**
 * Verifies that OpenCode's in-process MCP bridge (src/bun/engine/opencode/mcp-server.ts)
 * exposes the generic dynamic-mcp-discovery tools (list_mcp_servers/list_mcp_tools/
 * invoke_mcp_tool) once `CommonToolContext.runtime.mcpRegistry` is populated — see
 * openspec/changes/dynamic-mcp-discovery/tasks.md §8 (OpenCode wiring).
 *
 * OpenCode never had native MCP tool injection; `callTool()` in mcp-server.ts already
 * dispatches generically through `executeCommonTool`, so this test exercises the real
 * JSON-RPC/HTTP surface end-to-end with a real McpClientRegistry + injected FakeMcpClient
 * (no subprocess/network transport), confirming the discovery tools are reachable through
 * OpenCode's bridge without any changes to mcp-server.ts itself.
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { startOpenCodeMcpServer, type OpenCodeMcpServer, type McpContextEntry } from "../engine/opencode/mcp-server.ts";
import { McpClientRegistry } from "../mcp/registry.ts";
import { FakeMcpClient } from "./support/fake-mcp-client.ts";
import { TodoRepository } from "../db/todos.ts";
import { DecisionRepository } from "../db/repositories/decision-repository.ts";
import { NoteRepository } from "../db/repositories/note-repository.ts";
import { WorkspaceRepository } from "../db/workspace-repository.ts";
import { BoardToolExecutor } from "../workflow/tools/board-tool-executor.ts";
import { initDb } from "./helpers.ts";
import type { McpServerConfig } from "../mcp/types.ts";
import type { CommonToolContext } from "../engine/types.ts";

function stdioServer(name: string, overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return { name, transport: { type: "stdio", command: `${name}-cmd` }, ...overrides };
}

async function rpcCall(url: string, method: string, params?: unknown): Promise<any> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return res.json();
}

describe("OpenCode MCP bridge — dynamic discovery tools", () => {
  let server: OpenCodeMcpServer;
  let contextMap: Map<number, McpContextEntry>;
  let registry: McpClientRegistry;

  beforeEach(async () => {
    const db = initDb();
    const wsRepo = new WorkspaceRepository(db);

    registry = new McpClientRegistry(
      { servers: [stdioServer("alpha", { description: "Alpha things" })] },
      {
        clientFactory: () =>
          new FakeMcpClient({
            tools: [{ name: "echo", description: "echoes input", inputSchema: { type: "object" } }],
            callToolResult: "echoed!",
          }),
      },
    );
    await registry.startAll();

    const commonToolContext: CommonToolContext = {
      task: { id: null, boardId: null, conversationId: 42 },
      workspaceKey: "default",
      repos: {
        todos: new TodoRepository(db),
        decisions: new DecisionRepository(db),
        notes: new NoteRepository(db),
        boardTools: new BoardToolExecutor(db, wsRepo),
      },
      workflow: {
        onTransition: () => {},
        onHumanTurn: () => {},
        onCancel: () => {},
        onTaskUpdated: () => {},
      },
      runtime: {
        mcpRegistry: registry,
        // Visibility is opt-in by design (see discovery-tools.ts) — explicitly enable
        // "alpha:echo" so list_mcp_tools/invoke_mcp_tool can see and call it.
        mcpEnabledTools: ["alpha:echo"],
      },
    };

    contextMap = new Map([
      [42, { commonToolContext, executionId: 1, pendingQuestion: null, onAskUser: null }],
    ]);

    server = startOpenCodeMcpServer(contextMap);
  });

  afterAll(() => {
    server?.close();
  });

  it("lists list_mcp_servers/list_mcp_tools/invoke_mcp_tool via tools/list", async () => {
    const res = await rpcCall(server.url, "tools/list");
    const names = (res.result.tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toContain("list_mcp_servers");
    expect(names).toContain("list_mcp_tools");
    expect(names).toContain("invoke_mcp_tool");
  });

  it("dispatches list_mcp_servers through executeCommonTool generically", async () => {
    const res = await rpcCall(server.url, "tools/call", {
      name: "list_mcp_servers",
      arguments: { conversationId: 42 },
    });
    const text = res.result.content[0].text as string;
    expect(text).toContain("alpha");
    expect(text).toContain("Alpha things");
  });

  it("dispatches list_mcp_tools through executeCommonTool generically", async () => {
    const res = await rpcCall(server.url, "tools/call", {
      name: "list_mcp_tools",
      arguments: { conversationId: 42, server: "alpha" },
    });
    const text = res.result.content[0].text as string;
    expect(text).toContain("echo");
  });

  it("dispatches invoke_mcp_tool through executeCommonTool generically and reaches the fake client", async () => {
    const res = await rpcCall(server.url, "tools/call", {
      name: "invoke_mcp_tool",
      arguments: { conversationId: 42, server: "alpha", tool: "echo", arguments: { foo: "bar" } },
    });
    const text = res.result.content[0].text as string;
    expect(text).toContain("echoed!");
  });
});
