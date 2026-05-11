/**
 * Wraps the common Railyin tools (board management, todos, decisions, etc.)
 * as Pi AgentTool instances for use in the Pi engine.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { AIToolDefinition } from "../../ai/types.ts";
import type { CommonToolContext } from "../../types.ts";
import type { HarnessContext } from "../harness/context.ts";
import { COMMON_TOOL_DEFINITIONS, COMMON_TOOL_NAMES, executeCommonTool } from "../../common-tools.ts";

export type CommonToolExecutor = (
  name: string,
  args: Record<string, unknown>,
  ctx: CommonToolContext
) => Promise<Awaited<ReturnType<typeof executeCommonTool>>>;

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
        const result = await executor(def.name, args as Record<string, unknown>, ctx);
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
