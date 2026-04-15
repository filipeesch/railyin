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
 *
 * @param onInterviewMe - Optional callback invoked when the model calls `interview_me`.
 *   Receives the raw JSON string payload. Returning from this callback signals the
 *   engine to suspend and emit an interview_me EngineEvent.
 */
export function buildCopilotTools(
  context: CommonToolContext,
  onInterviewMe?: (payload: string) => void,
): Tool[] {
  const commonTools = COMMON_TOOL_DEFINITIONS.map((def) => ({
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

  if (!onInterviewMe) return commonTools;

  const interviewTool: Tool = {
    name: "interview_me",
    description:
      "Conduct a structured interview to gather direction on complex, high-stakes decisions.\n\n" +
      "ALWAYS use this tool — never plain prose — when the conversation requires architectural choices, technology selection, design tradeoffs, or any decision where the implications are non-trivial.\n\n" +
      "Each option MUST have a 'title' (short, scannable) and a 'description' (rich markdown) explaining concrete pros/cons, what the choice forecloses, and when it fits. The description is the most important field — write at least 3–5 sentences with bullet lists.\n\n" +
      "Use 'weight' to signal reversibility. Set 'model_lean' to your recommended option title and explain why in 'model_lean_reason'. ALWAYS batch all related decisions into one call.",
    parameters: {
      type: "object",
      properties: {
        context: { type: "string" },
        questions: {
          type: "array",
          items: {
            type: "object",
            properties: {
              question: { type: "string" },
              type: { type: "string", enum: ["exclusive", "non_exclusive", "freetext"] },
              weight: { type: "string", enum: ["critical", "medium", "easy"] },
              model_lean: { type: "string" },
              model_lean_reason: { type: "string" },
              answers_affect_followup: { type: "boolean" },
              options: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    title: { type: "string" },
                    description: { type: "string" },
                  },
                  required: ["title", "description"],
                },
              },
            },
            required: ["question", "type"],
          },
        },
      },
      required: ["questions"],
    },
    skipPermission: true,
    handler: async (args: unknown) => {
      onInterviewMe(JSON.stringify(args));
      return "Interview suspended — awaiting user response.";
    },
  };

  return [...commonTools, interviewTool];
}
