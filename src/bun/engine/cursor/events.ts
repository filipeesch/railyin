import type { EngineEvent } from "../types.ts";
import type { ToolCallDisplay } from "../../../shared/rpc-types.ts";
import { COMMON_TOOL_NAMES, buildCommonToolDisplay } from "../common-tools.ts";
import { canonicalToolDisplayLabel, humanizeToolName, stripWorktreePath } from "../tool-display.ts";
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
/**
 * Cursor reports every custom tool call (railyin_*, MCP, common task tools)
 * under the umbrella name "mcp" with the real tool name nested at
 * `args.toolName` and the real arguments at `args.args`. This helper unwraps
 * that envelope so downstream code sees the actual tool name.
 */
export function unwrapCursorToolName(
  name: string,
  args: Record<string, unknown> | undefined,
): { name: string; args: Record<string, unknown> } {
  if (name === "mcp" && args && typeof args.toolName === "string") {
    return {
      name: args.toolName,
      args: (args.args as Record<string, unknown> | undefined) ?? {},
    };
  }
  return { name, args: args ?? {} };
}

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
      // Cursor wraps every custom tool call under name "mcp" with the real
      // tool name nested at args.toolName and the real args at args.args.
      // Unwrap so the rest of Railyin sees the actual tool name.
      const { name: resolvedName, args: resolvedArgs } = unwrapCursorToolName(
        message.name,
        message.args as Record<string, unknown> | undefined,
      );
      if (message.status === "running") {
        events.push({
          type: "tool_start",
          name: resolvedName,
          arguments: JSON.stringify(resolvedArgs ?? {}),
          callId: message.call_id,
        });
      } else if (message.status === "completed" || message.status === "error") {
        events.push({
          type: "tool_result",
          name: resolvedName,
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

/**
 * Build the `display` metadata for a Cursor tool call.
 *
 * Cursor emits both SDK-builtin tools (Read, Write, Edit, Shell, Grep, Glob)
 * and Railyin-registered custom tools (railyin_* bypasses + common tools).
 * The UI uses `display.label` as the visible tool name in chat — without it,
 * the frontend falls back to the literal string "tool".
 */
export function buildCursorToolDisplay(
  name: string,
  args: Record<string, unknown>,
  worktreePath?: string,
): ToolCallDisplay {
  if (COMMON_TOOL_NAMES.has(name)) return buildCommonToolDisplay(name, args);
  const str = (v: unknown): string => (v != null ? String(v) : "");
  switch (name) {
    case "Read":
    case "railyin_read":
      return {
        label: canonicalToolDisplayLabel("read"),
        subject: stripWorktreePath(str(args.path || args.file_path) || undefined, worktreePath),
        contentType: "file",
        startLine: typeof args.start_line === "number" && args.start_line > 0 ? args.start_line : undefined,
      };
    case "Write":
      return {
        label: canonicalToolDisplayLabel("write"),
        subject: stripWorktreePath(str(args.path || args.file_path) || undefined, worktreePath),
        contentType: "file",
      };
    case "Edit":
    case "MultiEdit":
      return {
        label: canonicalToolDisplayLabel("edit"),
        subject: stripWorktreePath(str(args.path || args.file_path) || undefined, worktreePath),
        contentType: "file",
      };
    case "Shell":
    case "Bash":
    case "railyin_shell":
      return {
        label: canonicalToolDisplayLabel("bash"),
        subject: stripWorktreePath(str(args.command || args.cmd) || undefined, worktreePath),
        contentType: "terminal",
      };
    case "Grep":
    case "railyin_grep":
      return {
        label: canonicalToolDisplayLabel("grep"),
        subject: str(args.pattern || args.query) || undefined,
      };
    case "Glob":
    case "railyin_glob":
      return {
        label: canonicalToolDisplayLabel("glob"),
        subject: str(args.pattern) || undefined,
      };
    case "LS":
    case "List":
      return {
        label: canonicalToolDisplayLabel("ls"),
        subject: stripWorktreePath(str(args.path) || undefined, worktreePath),
      };
    case "WebFetch":
    case "web_fetch":
      return {
        label: canonicalToolDisplayLabel("webfetch"),
        subject: str(args.url) || undefined,
      };
    default:
      return { label: humanizeToolName(name) };
  }
}
