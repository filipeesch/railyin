/**
 * Wraps the common Railyin tools (board management, todos, decisions, etc.)
 * as Pi AgentTool instances for use in the Pi engine.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { CommonToolContext } from "../../types.ts";
import { COMMON_TOOL_DEFINITIONS, COMMON_TOOL_NAMES, executeCommonTool } from "../../common-tools.ts";
import { Type } from "@mariozechner/pi-ai";

/**
 * Build Pi AgentTool wrappers for every common Railyin tool.
 * The tool metadata (name, description, parameters schema) comes from
 * COMMON_TOOL_DEFINITIONS — execution delegates to executeCommonTool.
 */
export function buildCommonTools(ctx: CommonToolContext): AgentTool<any>[] {
  return COMMON_TOOL_DEFINITIONS.map((def) => {
    const tool: AgentTool<any> = {
      name: def.name,
      label: def.name.replace(/_/g, " "),
      description: def.description,
      // Pi uses TypeBox schemas; JSON Schema from COMMON_TOOL_DEFINITIONS is structurally
      // compatible — cast as any since both represent JSON Schema objects.
      parameters: def.parameters as any,
      execute: async (_toolCallId, args, _signal) => {
        const result = await executeCommonTool(def.name, args as Record<string, unknown>, ctx);
        const text = result.text ?? JSON.stringify(result);
        return {
          content: [{ type: "text", text }],
          details: { toolName: def.name },
        };
      },
    };
    return tool;
  });
}

export { COMMON_TOOL_NAMES };
