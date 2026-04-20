/**
 * Copilot tool registration — wraps common task-management tools as Copilot
 * custom tools via the SDK's Tool interface (Task 7.5).
 *
 * Converts COMMON_TOOL_DEFINITIONS from engine/common-tools.ts into the
 * @github/copilot-sdk Tool format, using raw JSON schemas as parameters.
 *
 * Tool groups registered:
 * - tasks_read: get_task, list_tasks, get_board_summary
 * - tasks_write: create_task, edit_task, delete_task, move_task, message_task
 */

import type { Tool } from "@github/copilot-sdk";
import type { CommonToolContext } from "../types.ts";
import { COMMON_TOOL_DEFINITIONS, executeCommonTool } from "../common-tools.ts";
import type { McpClientRegistry } from "../../mcp/registry.ts";

/**
 * Build the list of SDK Tool objects for a given execution context.
 * All common task-management tools are registered with JSON-schema parameters
 * and a handler that delegates to executeCommonTool().
 */
export function buildCopilotTools(
  context: CommonToolContext,
  mcpRegistry?: McpClientRegistry | null,
  enabledMcpTools?: string[] | null,
): Tool[] {
  const toToolArgs = (args: unknown): Record<string, string> => {
    if (!args || typeof args !== "object") return {};
    return Object.fromEntries(
      Object.entries(args as Record<string, unknown>).map(([key, value]) => {
        if (typeof value === "string") return [key, value];
        if (value == null) return [key, ""];
        try {
          return [key, JSON.stringify(value)];
        } catch {
          return [key, String(value)];
        }
      }),
    );
  };

  const commonTools = COMMON_TOOL_DEFINITIONS.map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters as Record<string, unknown>,
    skipPermission: true,
    handler: async (args: unknown) => {
      const result = await executeCommonTool(
        def.name,
        toToolArgs(args),
        context,
      );
      return result;
    },
  }));

  if (!mcpRegistry) return commonTools;

  const mcpTools = mcpRegistry.listTools(enabledMcpTools ?? null).map((def) => ({
    name: def.qualifiedName,
    description: def.description ?? `MCP tool: ${def.name}`,
    parameters: def.inputSchema as Record<string, unknown>,
    skipPermission: true,
    handler: async (args: unknown) => {
      return mcpRegistry.callTool(def.serverName, def.name, (args as Record<string, unknown>) ?? {});
    },
  }));

  return [...commonTools, ...mcpTools];
}
