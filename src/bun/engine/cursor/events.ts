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

/**
 * Extract a human-readable text result from a Cursor SDK tool_call message.
 *
 * Observed shapes for `message.result`:
 *
 *   1. Custom tools (railyin_*, MCP, common tools) — Cursor wraps the user's
 *      return value in `{ status: "success"|"error", value: { content: [{
 *      text: { text: "<actual output>" } }], isError } }`. Note the doubled
 *      `text.text` nesting — Cursor's content blocks aren't the Anthropic
 *      `{ type: "text", text }` shape.
 *   2. SDK built-in tools (Read/Write/Shell/Grep/Glob) — Anthropic-style
 *      `{ type: "tool_result", tool_use_id, content, is_error }` block,
 *      where `content` is either a string or an array of `{ type: "text",
 *      text }` blocks.
 *   3. Plain string (rare — some MCP tools).
 *
 * Without this normalization the UI rendered the raw JSON envelope.
 */
// Special-cases Cursor SDK built-in tool results that return structured value
// objects instead of content arrays. Falls back to normalizeCursorToolResult
// for all other tools (custom/MCP) which already handle their shapes correctly.
// Mirrors the identical function in worker.mjs — kept in sync manually.
export function normalizeBuiltinToolResult(
  name: string,
  rawResult: unknown,
): { result: string; detailedResult?: string } {
  if (name === "Edit" || name === "MultiEdit") {
    const raw = rawResult as Record<string, unknown> | null | undefined;
    const value = (raw?.value != null && typeof raw.value === "object")
      ? (raw.value as Record<string, unknown>)
      : {};
    const added = typeof value.linesAdded === "number" ? value.linesAdded : 0;
    const removed = typeof value.linesRemoved === "number" ? value.linesRemoved : 0;
    const diffString = typeof value.diffString === "string" ? value.diffString : undefined;
    const parts: string[] = [];
    if (added > 0) parts.push(`${added} line${added === 1 ? "" : "s"} added`);
    if (removed > 0) parts.push(`${removed} line${removed === 1 ? "" : "s"} removed`);
    const result = parts.length > 0 ? parts.join(", ") : "No changes";
    return diffString ? { result, detailedResult: diffString } : { result };
  }
  if (name === "Write") {
    const raw = rawResult as Record<string, unknown> | null | undefined;
    const value = (raw?.value != null && typeof raw.value === "object")
      ? (raw.value as Record<string, unknown>)
      : {};
    const linesCreated = typeof value.linesCreated === "number" ? value.linesCreated : 0;
    return { result: `File written (${linesCreated} line${linesCreated === 1 ? "" : "s"})` };
  }
  return { result: normalizeCursorToolResult(rawResult) };
}

export function normalizeCursorToolResult(rawResult: unknown): string {
  if (rawResult == null) return "";
  if (typeof rawResult === "string") return rawResult;
  if (typeof rawResult !== "object") return String(rawResult);
  const obj = rawResult as Record<string, unknown>;

  // Shape 1: { status, value: { content, isError } } — unwrap one level
  if (typeof obj.status === "string" && obj.value !== undefined) {
    return normalizeCursorToolResult(obj.value);
  }

  // Shape 2: { type: "tool_result", content, is_error }
  if (obj.type === "tool_result") {
    return extractCursorContent(obj.content);
  }

  // Inner of shape 1, or top-level content array on its own
  if (Array.isArray(obj.content)) return extractCursorContent(obj.content);
  if (typeof obj.content === "string") return obj.content;
  if (typeof obj.text === "string") return obj.text;

  try {
    return JSON.stringify(rawResult, null, 2);
  } catch {
    return String(rawResult);
  }
}

function extractCursorContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block) => extractTextFromBlock(block))
    .filter((t) => t.length > 0)
    .join("\n");
}

function extractTextFromBlock(block: unknown): string {
  if (typeof block === "string") return block;
  if (!block || typeof block !== "object") return "";
  const b = block as Record<string, unknown>;
  // Cursor nests: { text: { text: "..." } }
  if (b.text && typeof b.text === "object") {
    const inner = b.text as Record<string, unknown>;
    if (typeof inner.text === "string") return inner.text;
  }
  // Anthropic: { type: "text", text: "..." } (or just { text: "..." })
  if (typeof b.text === "string") return b.text;
  return "";
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
        const isError = message.status === "error";
        const { result: rawText, detailedResult } = normalizeBuiltinToolResult(resolvedName, message.result as unknown);
        const result = rawText.length > 0 ? rawText : isError ? "(tool returned an error with no message)" : "(no output)";
        events.push({
          type: "tool_result",
          name: resolvedName,
          result,
          callId: message.call_id,
          isError,
          ...(detailedResult ? { detailedResult } : {}),
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
