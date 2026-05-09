/**
 * Wraps the common Railyin tools (board management, todos, decisions, etc.)
 * as Pi AgentTool instances for use in the Pi engine.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { CommonToolContext, EngineEvent } from "../../types.ts";
import { COMMON_TOOL_DEFINITIONS, COMMON_TOOL_NAMES, executeCommonTool } from "../../common-tools.ts";
import { Type } from "@earendil-works/pi-ai";

export interface SuspendRef {
  onSuspend?: (event: EngineEvent) => void;
}

/**
 * Normalize args from local LLMs that serialize array/object parameters as JSON strings.
 * For example, `{ questions: "[{...}]" }` → `{ questions: [{...}] }`.
 */
function normalizeArgs(schema: { properties?: Record<string, { type?: string }> }, rawArgs: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...rawArgs };
  for (const [key, prop] of Object.entries(schema.properties ?? {})) {
    const val = result[key];
    if (typeof val !== "string") continue;
    if (prop.type === "array" || prop.type === "object") {
      try {
        result[key] = JSON.parse(val);
      } catch {
        // leave as-is
      }
    }
  }
  return result;
}

/**
 * Build Pi AgentTool wrappers for every common Railyin tool.
 * The tool metadata (name, description, parameters schema) comes from
 * COMMON_TOOL_DEFINITIONS — execution delegates to executeCommonTool.
 */
export function buildCommonTools(ctx: CommonToolContext, suspendRef?: SuspendRef): AgentTool<any>[] {
  return COMMON_TOOL_DEFINITIONS.map((def) => {
    const tool: AgentTool<any> = {
      name: def.name,
      label: def.name.replace(/_/g, " "),
      description: def.description,
      // Pi uses TypeBox schemas; JSON Schema from COMMON_TOOL_DEFINITIONS is structurally
      // compatible — cast as any since both represent JSON Schema objects.
      parameters: def.parameters as any,
      execute: async (_toolCallId, args, _signal) => {
        const normalizedArgs = normalizeArgs(def.parameters as { properties?: Record<string, { type?: string }> }, args as Record<string, unknown>);
        const result = await executeCommonTool(def.name, normalizedArgs, ctx);
        if (result.type === "suspend" && suspendRef?.onSuspend) {
          suspendRef.onSuspend({ type: "decision_request", payload: result.payload });
          return {
            content: [{ type: "text", text: "Decision request submitted. Waiting for user response." }],
            details: { toolName: def.name },
          };
        }
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
