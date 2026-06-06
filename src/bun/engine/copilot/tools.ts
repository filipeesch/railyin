/**
 * Copilot tool registration — wraps common task-management tools as Copilot
 * custom tools via the SDK's Tool interface (Task 7.5).
 *
 * Converts COMMON_TOOL_DEFINITIONS from engine/common-tools.ts into the
 * @github/copilot-sdk Tool format, using raw JSON schemas as parameters.
 *
 * Tool groups registered:
 * - cards_read: list_boards, get_card, list_cards, get_board_summary
 * - cards_write: create_card, edit_card, delete_card, move_card, message_card
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
  onSuspend?: (payload: string) => void,
): Tool[] {
  const commonTools = COMMON_TOOL_DEFINITIONS.map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters as Record<string, unknown>,
    skipPermission: true,
    handler: async (args: unknown) => {
      try {
        const result = await executeCommonTool(
          def.name,
          ((args && typeof args === "object" ? args : {}) as Record<string, unknown>),
          context,
        );
        if (result.type === "suspend") {
          onSuspend?.(result.payload);
          return "Interview suspended - awaiting user response.";
        }
        return result.text;
      } catch (err) {
        return `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
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
