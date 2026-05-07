/**
 * Translates Pi SDK AgentEvents into Railyin EngineEvents.
 */

import type { AgentEvent } from "@mariozechner/pi-agent-core";
import type { EngineEvent } from "../types.ts";
import type { FileDiffPayload } from "../../../shared/rpc-types.ts";
import { buildPiToolDisplay } from "./tools/display.ts";

/**
 * Translate a single Pi AgentEvent into zero or more EngineEvents.
 * Returns an array because some Pi events map to multiple engine events.
 */
export function translateEvent(event: AgentEvent, worktreePath?: string): EngineEvent[] {
  switch (event.type) {
    case "message_update": {
      const ae = event.assistantMessageEvent;
      if (ae.type === "text_delta") {
        return [{ type: "token", content: ae.delta }];
      }
      if (ae.type === "thinking_delta") {
        return [{ type: "reasoning", content: ae.delta }];
      }
      return [];
    }

    case "tool_execution_start": {
      const args: Record<string, unknown> =
        typeof event.args === "string"
          ? (() => { try { return JSON.parse(event.args); } catch { return {}; } })()
          : (event.args as Record<string, unknown>) ?? {};
      return [
        {
          type: "tool_start",
          name: event.toolName,
          arguments: typeof event.args === "string" ? event.args : JSON.stringify(event.args),
          callId: event.toolCallId,
          display: buildPiToolDisplay(event.toolName, args, worktreePath),
        },
      ];
    }

    case "tool_execution_end": {
      const result = event.result as {
        content?: Array<{ type: string; text?: string }>;
        details?: { writtenFiles?: FileDiffPayload[] };
      } | undefined;

      const text = result?.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("") ?? (event.isError ? "Tool execution failed" : "");

      const writtenFiles = result?.details?.writtenFiles;

      return [
        {
          type: "tool_result",
          name: event.toolName,
          result: text,
          callId: event.toolCallId,
          isError: event.isError,
          ...(writtenFiles ? { writtenFiles } : {}),
        },
      ];
    }

    // agent_start, agent_end, turn_start, turn_end, message_start, message_end,
    // tool_execution_update — no direct EngineEvent equivalent
    default:
      return [];
  }
}
