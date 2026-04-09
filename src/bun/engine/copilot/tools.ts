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

/**
 * Build the list of SDK Tool objects for a given execution context.
 * All common task-management tools are registered with JSON-schema parameters
 * and a handler that delegates to executeCommonTool().
 */
export function buildCopilotTools(context: CommonToolContext): Tool[] {
  return COMMON_TOOL_DEFINITIONS.map((def) => ({
    name: def.name,
    description: def.description,
    parameters: def.parameters as Record<string, unknown>,
    skipPermission: true,
    handler: async (args: unknown) => {
      const result = await executeCommonTool(
        def.name,
        args as Record<string, string>,
        context,
      );
      return result;
    },
  }));
}
