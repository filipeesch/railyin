import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";
import { getDb } from "../db/index.ts";
import { mapTask } from "../db/mappers.ts";
import type { TaskRow } from "../db/row-types.ts";
import { getDataDir, loadMcpConfig } from "../config/index.ts";
import { getMcpRegistry, initMcpRegistry } from "../mcp/registry.ts";
import type { McpServerStatus } from "../mcp/types.ts";
import type { Task } from "../../shared/rpc-types.ts";

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
      // Reload registry with new config
      const newConfig = loadMcpConfig();
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
  };
}
