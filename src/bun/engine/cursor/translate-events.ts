/**
 * Shared translation module for Cursor SDK event translation.
 *
 * Contains the canonical implementations of:
 *   - translateCursorMessage() — SDKMessage → EngineEvent[]
 *   - normalizeCursorToolResult() — raw result → plain string
 *   - extractStructuredResult() — raw result → { detailedResult, writtenFiles }
 *   - unwrapCursorToolName() — unwrap MCP envelope
 *   - buildCursorToolDisplay() — tool name + args → ToolCallDisplay
 *
 * This module is imported by:
 *   - src/bun/engine/cursor/events.ts
 *   - src/bun/engine/cursor/inprocess-adapter.ts
 */

import type { EngineEvent } from "../types.ts";
import type { ToolCallDisplay, FileDiffPayload, Hunk } from "../../../shared/rpc-types.ts";
import { COMMON_TOOL_NAMES, buildCommonToolDisplay } from "../common-tools.ts";
import { canonicalToolDisplayLabel, humanizeToolName, stripWorktreePath } from "../tool-display.ts";
import { parseUnifiedDiff } from "../diff-utils.ts";export { parseUnifiedDiff } from "../diff-utils.ts";

/* ─── SDK Message Type (minimal) ─── */

export interface CursorSDKMessage {
  type: string;
  call_id?: string;
  name?: string;
  status?: string;
  args?: Record<string, unknown>;
  result?: unknown;
  // For `type: "assistant"` this is `SDKAssistantMessage["message"]` (an object with
  // `content` blocks); for `type: "status"` it's a plain string status message.
  message?: unknown;
  text?: string;
}

/* ─── Structured Result Extraction ─── */

export interface StructuredResult {
  detailedResult?: string;
  writtenFiles?: FileDiffPayload[];
}

/**
 * Extract structured data from a Cursor SDK tool result.
 *
 * Handles:
 *   - Shell: extracts stdout/stderr into detailedResult
 *   - Edit/Write: parses diffString into writtenFiles with hunks
 *   - Delete: handles empty result gracefully
 *   - Read: passes through content as detailedResult
 *   - Unknown: falls back to JSON stringify
 */
export function extractStructuredResult(rawResult: unknown): StructuredResult {
  if (rawResult == null) return {};
  if (typeof rawResult !== "object") return {};

  const obj = rawResult as Record<string, unknown>;

  // Unwrap Cursor's { status, value } envelope
  if (typeof obj.status === "string" && obj.value !== undefined) {
    return extractStructuredResult(obj.value);
  }

  const value = obj as Record<string, unknown>;

  // Shell: { exitCode, signal, stdout, stderr }
  if (typeof value.exitCode === "number" || typeof value.stdout === "string") {
    const stdout = typeof value.stdout === "string" ? value.stdout : "";
    const stderr = typeof value.stderr === "string" && value.stderr ? `\n${value.stderr}` : "";
    return { detailedResult: stdout + stderr };
  }

  // Edit/Write: { linesAdded, linesRemoved, diffString }
  if (typeof value.diffString === "string" && value.diffString.includes("@@")) {
    const diffPath = extractPathFromDiff(value.diffString);
    const diffPayload = parseUnifiedDiff(value.diffString, diffPath || "unknown", "edit_file");
    return {
      writtenFiles: [{
        operation: diffPayload.operation,
        path: diffPayload.path,
        added: diffPayload.added,
        removed: diffPayload.removed,
        hunks: diffPayload.hunks,
      }],
    };
  }

  // Delete: { } (empty value)
  if (Object.keys(value).length === 0) {
    return { detailedResult: "(file deleted)" };
  }

  // Read: { content: "..." }
  if (typeof value.content === "string") {
    return { detailedResult: value.content };
  }

  // Fallback: JSON stringify
  try {
    return { detailedResult: JSON.stringify(rawResult, null, 2) };
  } catch {
    return {};
  }
}

/**
 * Extract file path from unified diff headers (--- a/path, +++ b/path).
 */
function extractPathFromDiff(diffString: string): string | undefined {
  const lines = diffString.split("\n");
  for (const line of lines) {
    if (line.startsWith("--- ")) {
      const raw = line.slice(4).trim().replace(/^[ab]\//, "");
      if (raw !== "/dev/null") return raw;
    }
  }
  return undefined;
}

/* ─── Normalize Cursor Tool Result ─── */

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

/* ─── MCP Envelope Unwrapping ─── */

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

/* ─── Build Display Metadata ─── */

/**
 * Build the `display` metadata for a Cursor tool call.
 *
 * Cursor emits both SDK-builtin tools (read, write, edit, shell, grep, glob)
 * and Railyin-registered custom tools (railyin_* bypasses + common tools).
 * The UI uses `display.label` as the visible tool name in chat — without it,
 * the frontend falls back to the literal string "tool".
 *
 * Tool names are LOWERCASE to match the Cursor SDK's actual naming convention.
 */
export function buildCursorToolDisplay(
  name: string,
  args: Record<string, unknown>,
  worktreePath?: string,
): ToolCallDisplay {
  if (COMMON_TOOL_NAMES.has(name)) return buildCommonToolDisplay(name, args);
  const str = (v: unknown): string => (v != null ? String(v) : "");
  // Lowercase the name for case-insensitive matching
  const lowerName = name.toLowerCase();
  switch (lowerName) {
    case "read":
    case "railyin_read":
      return {
        label: canonicalToolDisplayLabel("read"),
        subject: stripWorktreePath(str(args.path || args.file_path) || undefined, worktreePath),
        contentType: "file",
        startLine: typeof args.start_line === "number" && args.start_line > 0 ? args.start_line : undefined,
      };
    case "write":
    case "railyin_write":
      return {
        label: canonicalToolDisplayLabel("write"),
        subject: stripWorktreePath(str(args.path || args.file_path) || undefined, worktreePath),
        contentType: "file",
      };
    case "edit":
    case "multedit":
    case "railyin_edit":
      return {
        label: canonicalToolDisplayLabel("edit"),
        subject: stripWorktreePath(str(args.path || args.file_path) || undefined, worktreePath),
        contentType: "file",
      };
    case "shell":
    case "bash":
    case "railyin_shell":
      return {
        label: canonicalToolDisplayLabel("bash"),
        subject: stripWorktreePath(str(args.command || args.cmd) || undefined, worktreePath),
        contentType: "terminal",
      };
    case "grep":
    case "railyin_grep":
      return {
        label: canonicalToolDisplayLabel("grep"),
        subject: str(args.pattern || args.query) || undefined,
      };
    case "glob":
    case "railyin_glob":
      return {
        label: canonicalToolDisplayLabel("glob"),
        subject: str(args.pattern) || undefined,
      };
    case "delete":
      return {
        label: canonicalToolDisplayLabel("delete"),
        subject: stripWorktreePath(str(args.path || args.file_path) || undefined, worktreePath),
        contentType: "file",
      };
    case "ls":
    case "list":
      return {
        label: canonicalToolDisplayLabel("ls"),
        subject: stripWorktreePath(str(args.path) || undefined, worktreePath),
      };
    case "webfetch":
    case "web_fetch":
      return {
        label: canonicalToolDisplayLabel("webfetch"),
        subject: str(args.url) || undefined,
      };
    default:
      return { label: humanizeToolName(name) };
  }
}

/* ─── Translate SDK Message to EngineEvents ─── */

/**
 * Translate a Cursor SDK message to EngineEvent(s).
 *
 * Converts Cursor SDK message types to Railyin's unified EngineEvent format:
 *   assistant - transforms text deltas to "token" events
 *   thinking - converts reasoning to "reasoning" events
 *   tool_call - handles tool_start and tool_result (with display, detailedResult, writtenFiles)
 *   status - handles status updates
 */
export function translateCursorMessage(message: CursorSDKMessage): EngineEvent[] {
  const events: EngineEvent[] = [];

  switch (message.type) {
    case "assistant": {
      // The real @cursor/sdk field is `message.content` (SDKAssistantMessage["message"]),
      // an object like { role: "assistant", content: [{ type: "text", text }] }.
      const messageObj = message.message as { content?: Array<{ type?: string; text?: string }> } | undefined;
      const contentBlocks = messageObj?.content ?? [];
      const content = contentBlocks
        .filter((block) => block.type === "text")
        .map((block) => block.text ?? "")
        .join("");
      if (content) {
        events.push({ type: "token", content });
      }
      break;
    }

    case "thinking": {
      if (message.text) {
        events.push({ type: "reasoning", content: message.text });
      }
      break;
    }

    case "tool_call": {
      // Cursor wraps every custom tool call under name "mcp" with the real
      // tool name nested at args.toolName and the real args at args.args.
      // Unwrap so the rest of Railyin sees the actual tool name.
      const { name: resolvedName, args: resolvedArgs } = unwrapCursorToolName(
        message.name ?? "",
        message.args as Record<string, unknown> | undefined,
      );

      if (message.status === "running") {
        const display = buildCursorToolDisplay(resolvedName, resolvedArgs);
        events.push({
          type: "tool_start",
          name: resolvedName,
          arguments: JSON.stringify(resolvedArgs),
          callId: message.call_id,
          display,
        });
      } else if (message.status === "completed" || message.status === "error") {
        const isError = message.status === "error";
        const text = normalizeCursorToolResult(message.result);
        const result = text.length > 0 ? text : isError ? "(tool returned an error with no message)" : "(no output)";
        const structured = extractStructuredResult(message.result);
        const display = buildCursorToolDisplay(resolvedName, resolvedArgs);
        events.push({
          type: "tool_result",
          name: resolvedName,
          result,
          callId: message.call_id,
          isError,
          display,
          ...structured,
        });
      }
      break;
    }

    case "status": {
      events.push({
        type: "status",
        message: typeof message.message === "string" ? message.message : String(message.message ?? ""),
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
