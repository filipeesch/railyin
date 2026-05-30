import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import type { Database } from "bun:sqlite";
import { mapChatSession, mapTask } from "../db/mappers.ts";
import type { ChatSessionRow, TaskRow } from "../db/row-types.ts";
import { getDataDir } from "../config/index.ts";
import type { McpServerStatus } from "../mcp/types.ts";
import type { McpRegistryPool } from "../mcp/registry-pool.ts";
import type { ChatSession, Task } from "../../shared/rpc-types.ts";

export function mcpHandlers(db: Database, { registryPool, resolveProject }: {
  registryPool: McpRegistryPool;
  resolveProject: (workspaceKey: string, projectKey: string) => { projectPath: string } | null;
}) {
  return {
    "mcp.getStatus": async (_params: Record<string, never>): Promise<McpServerStatus[]> => {
      return registryPool.getGlobalRegistry().getStatus();
    },

    "mcp.reload": async (params: { serverName?: string }): Promise<McpServerStatus[]> => {
      const registry = registryPool.getGlobalRegistry();
      await registry.reload(params.serverName);
      return registry.getStatus();
    },

    "mcp.getConfig": async (_params: Record<string, never>): Promise<{ path: string; content: string }> => {
      const globalPath = join(getDataDir(), "mcp.json");
      if (existsSync(globalPath)) {
        return { path: globalPath, content: readFileSync(globalPath, "utf-8") };
      }
      return { path: globalPath, content: JSON.stringify({ servers: [] }, null, 2) };
    },

    "mcp.saveConfig": async (params: { content: string }): Promise<{ ok: true }> => {
      const globalPath = join(getDataDir(), "mcp.json");
      const dir = dirname(globalPath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      JSON.parse(params.content); // validate JSON — throws if invalid
      writeFileSync(globalPath, params.content, "utf-8");
      registryPool.resetGlobal();
      const newRegistry = registryPool.getGlobalRegistry();
      await newRegistry.startAll();
      return { ok: true };
    },

    "mcp.getProjectConfig": async (params: { workspaceKey: string; projectKey: string }): Promise<{ path: string; content: string }> => {
      const project = resolveProject(params.workspaceKey, params.projectKey);
      if (!project) throw new Error(`Project '${params.projectKey}' not found in workspace '${params.workspaceKey}'`);
      const { projectPath } = project;
      const configPath = join(projectPath, ".railyn", "mcp.json");
      if (existsSync(configPath)) {
        return { path: configPath, content: readFileSync(configPath, "utf-8") };
      }
      return { path: configPath, content: JSON.stringify({ servers: [] }, null, 2) };
    },

    "mcp.saveProjectConfig": async (params: { workspaceKey: string; projectKey: string; content: string }): Promise<{ ok: true }> => {
      const project = resolveProject(params.workspaceKey, params.projectKey);
      if (!project) throw new Error(`Project '${params.projectKey}' not found in workspace '${params.workspaceKey}'`);
      const { projectPath } = project;
      const configPath = join(projectPath, ".railyn", "mcp.json");
      const dir = dirname(configPath);
      JSON.parse(params.content); // validate JSON — throws if invalid
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(configPath, params.content, "utf-8");
      registryPool.invalidate(projectPath);
      return { ok: true };
    },

    "mcp.setTaskTools": async (params: { taskId: number; enabledTools: string[] | null }): Promise<Task> => {
      const value = params.enabledTools === null ? null : JSON.stringify(params.enabledTools);
      db.run("UPDATE tasks SET enabled_mcp_tools = ? WHERE id = ?", [value, params.taskId]);
      const row = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(params.taskId);
      if (!row) throw new Error(`Task ${params.taskId} not found`);
      return mapTask(row);
    },

    "mcp.setSessionTools": async (params: { sessionId: number; enabledTools: string[] | null }): Promise<ChatSession> => {
      const value = params.enabledTools === null ? null : JSON.stringify(params.enabledTools);
      db.run("UPDATE chat_sessions SET enabled_mcp_tools = ? WHERE id = ?", [value, params.sessionId]);
      const row = db.query<ChatSessionRow, [number]>("SELECT * FROM chat_sessions WHERE id = ?").get(params.sessionId);
      if (!row) throw new Error(`Chat session ${params.sessionId} not found`);
      return mapChatSession(row);
    },
  };
}
