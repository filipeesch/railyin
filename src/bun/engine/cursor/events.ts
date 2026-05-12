import type { EngineEvent } from "../types.ts";
import type { SDKMessage } from "@cursor/sdk";

/**
 * Cursor SDK event translation - maps SDK messages to EngineEvent types.
 *
 * Converts Cursor SDK message types to Railyin's unified EngineEvent format:
 *   assistant - transforms text deltas to "token" events
 *   thinking - converts reasoning to "reasoning" events
 *   tool_call - handles tool_start and tool_result
 *   status - handles status updates
 */

/**
 * Translate a Cursor SDK message to EngineEvent(s).
 *
 * @param message The SDK message to translate
 * @returns Array of EngineEvent(s) to yield
 */
export function translateCursorMessage(message: SDKMessage): EngineEvent[] {
  const events: EngineEvent[] = [];

  switch (message.type) {
    case "assistant": {
      // Extract text from content blocks
      const content = message.message.content
        .filter((block) => block.type === "text")
        .map((block) => (block as { text?: string }).text ?? "")
        .join("");
      if (content) {
        events.push({ type: "token", content });
      }
      break;
    }

    case "thinking": {
      if ((message as any).text) {
        events.push({ type: "reasoning", content: (message as any).text });
      }
      break;
    }

    case "tool_call": {
      if (message.status === "running") {
        events.push({
          type: "tool_start",
          name: message.name,
          arguments: JSON.stringify(message.args ?? {}),
          callId: message.call_id,
        });
      } else if (message.status === "completed" || message.status === "error") {
        events.push({
          type: "tool_result",
          name: message.name,
          result: JSON.stringify(message.result ?? ""),
          callId: message.call_id,
          isError: message.status === "error",
        });
      }
      break;
    }

    case "status": {
      events.push({
        type: "status",
        message: message.message ?? "",
      });
      break;
    }

    case "user":
    case "system":
    case "request":
    case "task":
      // These are informational and don't need translation
      break;
  }

  return events;
}
