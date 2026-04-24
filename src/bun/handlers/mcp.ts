import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { getDb } from "../db/index.ts";
import { mapChatSession, mapTask } from "../db/mappers.ts";
import type { ChatSessionRow, TaskRow } from "../db/row-types.ts";
import { getDataDir } from "../config/index.ts";
import { getMcpRegistry, initMcpRegistry } from "../mcp/registry.ts";
import type { McpConfig, McpServerConfig, McpServerStatus } from "../mcp/types.ts";
import type { ChatSession, Task } from "../../shared/rpc-types.ts";

// Support both VS Code format ({ servers: { name: {...} } }) and internal format ({ servers: [...] })
function normalizeToMcpConfig(parsed: unknown): McpConfig {
  const p = parsed as Record<string, unknown>;
  if (!p || typeof p !== "object" || !p.servers) return { servers: [] };
  if (Array.isArray(p.servers)) return { servers: p.servers as McpServerConfig[] };
  // VS Code object-map format
  const servers: McpServerConfig[] = Object.entries(p.servers as Record<string, unknown>).map(
    ([name, entry]) => {
      const e = entry as Record<string, unknown>;
      const transport = e.url
        ? { type: "http" as const, url: e.url as string, headers: e.headers as Record<string, string> | undefined }
        : { type: "stdio" as const, command: e.command as string, args: e.args as string[] | undefined, env: e.env as Record<string, string> | undefined };
      return { name, transport };
    }
  );
  return { servers };
}

export function mcpHandlers() {
  return {
    "mcp.getStatus": async (_params: Record<string, never>): Promise<McpServerStatus[]> => {
      const registry = getMcpRegistry();
      if (!registry) return [];
      return registry.getStatus();
    },

    "mcp.reload": async (params: { serverName?: string }): Promise<McpServerStatus[]> => {
      const registry = getMcpRegistry();
      if (!registry) return [];
      await registry.reload(params.serverName);
      return registry.getStatus();
    },

    "mcp.getConfig": async (_params: Record<string, never>): Promise<{ path: string; content: string }> => {
      const globalPath = join(getDataDir(), "mcp.json");
      if (existsSync(globalPath)) {
        return { path: globalPath, content: readFileSync(globalPath, "utf-8") };
      }
      const template = JSON.stringify({ servers: [] }, null, 2);
      return { path: globalPath, content: template };
    },

    "mcp.saveConfig": async (params: { content: string }): Promise<{ ok: true }> => {
      const globalPath = join(getDataDir(), "mcp.json");
      const dir = dirname(globalPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      // Validate JSON before saving
      JSON.parse(params.content); // throws if invalid
      writeFileSync(globalPath, params.content, "utf-8");
      // Parse and reload registry with new config
      const parsed = JSON.parse(params.content);
      const newConfig: McpConfig = normalizeToMcpConfig(parsed);
      const registry = initMcpRegistry(newConfig);
      await registry.startAll();
      return { ok: true };
    },

    "mcp.setTaskTools": async (params: { taskId: number; enabledTools: string[] | null }): Promise<Task> => {
      const db = getDb();
      const value = params.enabledTools === null ? null : JSON.stringify(params.enabledTools);
      db.run("UPDATE tasks SET enabled_mcp_tools = ? WHERE id = ?", [value, params.taskId]);
      const row = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(params.taskId);
      if (!row) throw new Error(`Task ${params.taskId} not found`);
      return mapTask(row);
    },

    "mcp.setSessionTools": async (params: { sessionId: number; enabledTools: string[] | null }): Promise<ChatSession> => {
      const db = getDb();
      const value = params.enabledTools === null ? null : JSON.stringify(params.enabledTools);
      db.run("UPDATE chat_sessions SET enabled_mcp_tools = ? WHERE id = ?", [value, params.sessionId]);
      const row = db.query<ChatSessionRow, [number]>("SELECT * FROM chat_sessions WHERE id = ?").get(params.sessionId);
      if (!row) throw new Error(`Chat session ${params.sessionId} not found`);
      return mapChatSession(row);
    },
  };
}
