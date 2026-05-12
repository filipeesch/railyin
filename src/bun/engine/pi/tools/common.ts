/**
 * Wraps the common Railyin tools (board management, todos, decisions, etc.)
 * as Pi AgentTool instances for use in the Pi engine.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AIToolDefinition } from "../../../ai/types.ts";
import type { CommonToolContext, EngineEvent } from "../../types.ts";
import type { HarnessContext } from "../harness/context.ts";
import { COMMON_TOOL_DEFINITIONS, COMMON_TOOL_NAMES, executeCommonTool } from "../../common-tools.ts";

export interface SuspendRef {
  onSuspend?: (event: EngineEvent) => void;
}

export type CommonToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  ctx: CommonToolContext
) => Promise<Awaited<ReturnType<typeof executeCommonTool>>>;

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
 *
 * When harnessCtx is provided, write-producing tools (e.g. lsp_rename) that
 * return beforeFiles will push a snapshot to the UndoStack automatically.
 *
 * @param toolDefs - Tool definitions to wrap (defaults to COMMON_TOOL_DEFINITIONS)
 * @param executor - Function to execute tools (defaults to executeCommonTool, injectable for tests)
 */
export function buildCommonTools(
  ctx: CommonToolContext,
  harnessCtx?: HarnessContext,
  suspendRef?: SuspendRef,
  toolDefs: AIToolDefinition[] = COMMON_TOOL_DEFINITIONS,
  executor: CommonToolExecutor = executeCommonTool
): AgentTool<any>[] {
  return toolDefs.map((def) => {
    const tool: AgentTool<any> = {
      name: def.name,
      label: def.name.replace(/_/g, " "),
      description: def.description,
      // Pi uses TypeBox schemas; JSON Schema from COMMON_TOOL_DEFINITIONS is structurally
      // compatible — cast as any since both represent JSON Schema objects.
      parameters: def.parameters as any,
      execute: async (_toolCallId, args, _signal) => {
        const normalizedArgs = normalizeArgs(def.parameters as { properties?: Record<string, { type?: string }> }, args as Record<string, unknown>);
        const result = await executor(def.name, normalizedArgs, ctx);
        if (result.type === "suspend" && suspendRef?.onSuspend) {
          suspendRef.onSuspend({ type: "decision_request", payload: result.payload });
          return {
            content: [{ type: "text", text: "Decision request submitted. Waiting for user response." }],
            details: { toolName: def.name },
          };
        }
        let text = result.text ?? JSON.stringify(result);

        if (result.type === "result" && result.beforeFiles && harnessCtx) {
          const opId = harnessCtx.undoStack.push({
            type: "lsp_rename",
            beforeFiles: result.beforeFiles,
          });
          text = `${text} [${opId}]`;
        }


        return {
          content: [{ type: "text", text }],
          details: {
            toolName: def.name,
            ...(result.type === "result" && result.writtenFiles ? { writtenFiles: result.writtenFiles } : {}),
          },
        };
      },
    };
    return tool;
  });
}

export { COMMON_TOOL_NAMES };
