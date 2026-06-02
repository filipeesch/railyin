import type { EngineEvent } from "../types.ts";
import type { ToolCallDisplay } from "../../../shared/rpc-types.ts";
import { computeFileDiff } from "../../utils/diff.ts";
import type { FileStateCache } from "./file-state-cache.ts";
import { readFileSync } from "node:fs";
import { COMMON_TOOL_NAMES, buildCommonToolDisplay } from "../common-tools.ts";
import { canonicalToolDisplayLabel, stripRailyinMcpPrefix, humanizeToolName, stripWorktreePath } from "../tool-display.ts";

interface ClaudeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;  // tool_use blocks have an id
  name?: string;  // tool_use blocks have a name
  input?: Record<string, unknown>;  // tool_use blocks have input
  tool_use_id?: string;  // tool_result blocks reference a tool_use_id
  content?: string | Array<{ type: string; text?: string }>;
}

interface ClaudeAssistantMessage {
  type: "assistant";
  message?: {
    content?: ClaudeContentBlock[];
  };
}

interface ClaudeResultMessage {
  type: "result";
  subtype?: string;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
  errors?: string[];
  error?: string;
}

interface ClaudeSystemMessage {
  type: "system";
  subtype?: string;
  summary?: string;
  content?: string;
  status?: string | null;
}

export interface ToolMetadata {
  name: string;
  arguments?: unknown;
}

type ClaudeSdkMessage = ClaudeAssistantMessage | ClaudeResultMessage | ClaudeSystemMessage | { type: string;[key: string]: unknown };

export function translateClaudeMessage(
  message: ClaudeSdkMessage,
  options?: { toolMetaByCallId?: Map<string, ToolMetadata>; worktreePath?: string; fileStateCache?: FileStateCache },
): EngineEvent[] {
  const toolMetaByCallId = options?.toolMetaByCallId;
  const worktreePath = options?.worktreePath;
  const fileStateCache = options?.fileStateCache;
  const raw = message as Record<string, unknown>;
  // For system/init log the slash_commands list specifically; for everything else truncate
  if (raw["type"] === "system" && raw["subtype"] === "init") {
    const slashCommands = (raw as Record<string, unknown>)["slash_commands"];
    console.error("[claude-events] system/init slash_commands:", JSON.stringify(slashCommands));
  } else {
    console.error("[claude-events] raw message:", JSON.stringify(raw).slice(0, 500));
  }

  switch (message.type) {
    case "assistant": {
      const assistant = message as ClaudeAssistantMessage;
      const events: EngineEvent[] = [];
      for (const block of assistant.message?.content ?? []) {
        // text and thinking blocks are skipped here: they arrive incrementally via stream_event
        // (SDK emits BOTH stream_event deltas AND a final assembled assistant message when
        //  includePartialMessages: true is set — so we suppress them here to avoid double-emit)
        if (block.type === "tool_use" && block.id && block.name) {
          const resolvedName = stripRailyinMcpPrefix(block.name);
          // Store tool metadata for later pairing with tool_result
          if (toolMetaByCallId) {
            toolMetaByCallId.set(block.id, {
              name: resolvedName,
              arguments: block.input,
            });
          }
          // Capture file content before tool executes (for write/edit/multiedit diff accuracy)
          if (fileStateCache && isWriteToolName(resolvedName) && block.input && typeof block.input === "object") {
            const filePath = (block.input as Record<string, unknown>).file_path as string | undefined;
            if (filePath) {
              fileStateCache.capture(block.id, worktreePath ?? "", filePath);
            }
          }
          // Emit tool_start event with preserved callId
          events.push({
            type: "tool_start",
            callId: block.id,
            name: resolvedName,
            arguments: JSON.stringify(block.input ?? {}),
            isInternal: isInternalClaudeToolName(resolvedName),
            display: COMMON_TOOL_NAMES.has(resolvedName)
              ? buildCommonToolDisplay(resolvedName, block.input ?? {})
              : buildClaudeBuiltinDisplay(resolvedName, block.input ?? {}, worktreePath),
          });
        }
      }
      return events;
    }

    case "result": {
      const result = message as ClaudeResultMessage;
      const events: EngineEvent[] = [];

      // Check for rate limit event
      if (result.subtype === "rate_limit_event") {
        events.push({
          type: "status",
          message: "Claude API rate limited. Retrying...",
        });
      }

      if (result.usage) {
        events.push({
          type: "usage",
          inputTokens: result.usage.input_tokens ?? 0,
          outputTokens: result.usage.output_tokens ?? 0,
        });
      }

      if (result.subtype === "success") {
        events.push({ type: "done" });
      } else if (result.subtype !== "rate_limit_event") {
        events.push({
          type: "error",
          message: result.errors?.join("\n") || result.error || `Claude execution failed (${result.subtype ?? "unknown"})`,
          fatal: true,
        });
      }
      return events;
    }

    case "system": {
      const system = message as ClaudeSystemMessage;
      if (system.subtype === "local_command_output" && typeof system.content === "string" && system.content.trim()) {
        // Local slash commands (e.g. /opsx:explore) report their text via this event.
        return [{ type: "token", content: system.content }];
      }
      if (system.subtype === "compaction_summary") {
        // The onCompactProgress hook already emitted compaction_start/compaction_done.
        // This system message is a fallback in case the hook did not fire (e.g. older CLI).
        // Emit compaction_done here; deduplication happens in the orchestrator.
        return [{ type: "compaction_done" }];
      }
      if (typeof system.status === "string" && system.status.trim()) {
        return [{ type: "status", message: system.status }];
      }
      if (system.summary && system.subtype !== "compaction_summary") {
        return [{ type: "status", message: system.summary }];
      }
      return [];
    }

    case "user": {
      // Handle user messages that may contain tool_result blocks
      const user = message as any;
      const events: EngineEvent[] = [];
      const content = user.message?.content ?? user.content ?? [];
      const blocks = Array.isArray(content) ? content : [content];

      for (const block of blocks) {
        if (block?.type === "tool_result" && block.tool_use_id) {
          // Look up tool metadata stored from preceding tool_use
          const meta = toolMetaByCallId?.get(block.tool_use_id);
          const toolName = meta?.name ?? "unknown";

          if (!meta) {
            console.warn(`[claude-events] tool_result references unknown tool_use_id: ${block.tool_use_id}`);
          }

          // Emit tool_result event
          const rawContent = block.content;
          const normalizedContent: string = Array.isArray(rawContent)
            ? (rawContent as Array<{ type: string; text?: string }>)
                .filter((b) => b.type === "text" && typeof b.text === "string")
                .map((b) => b.text as string)
                .join("\n")
            : (rawContent ?? "");

          // Extract detailedContent from JSON envelope if present (common tools wrap results)
          let detailedResult: string | undefined;
          try {
            const parsed = JSON.parse(normalizedContent);
            if (parsed && typeof parsed.detailedContent === "string" && parsed.detailedContent) {
              detailedResult = parsed.detailedContent;
            }
          } catch { /* not JSON envelope */ }

          // Compute accurate file diff for write/edit/multiedit tools
          // detailedResult contains the after-content from the tool's JSON envelope
          const writtenFiles = computeWrittenFiles(
            toolName,
            meta?.arguments,
            block.tool_use_id,
            fileStateCache,
            worktreePath ?? "",
            detailedResult,
          );

          events.push({
            type: "tool_result",
            callId: block.tool_use_id,
            name: toolName,
            result: normalizedContent,
            detailedResult,
            isError: block.is_error ?? false,
            writtenFiles,
          });

          // Clean up from map
          if (toolMetaByCallId) {
            toolMetaByCallId.delete(block.tool_use_id);
          }
        }
      }
      return events;
    }

    case "stream_event": {
      const evt = (message as { event?: { type?: string; delta?: { type?: string; text?: string; thinking?: string } } }).event;
      if (evt?.type === "content_block_delta") {
        const delta = evt.delta;
        if (delta?.type === "text_delta" && delta.text) {
          return [{ type: "token", content: delta.text }];
        }
        if (delta?.type === "thinking_delta" && delta.thinking) {
          return [{ type: "reasoning", content: delta.thinking }];
        }
      }
      return [];
    }

    default:
      return [];
  }
}

/** Tool names that operate on files and need before-content capture for diff accuracy. */
function isWriteToolName(name: string): boolean {
  const lower = name.toLowerCase();
  return lower === "write" || lower === "edit" || lower === "multiedit";
}

/**
 * Compute accurate file diff for write/edit/multiedit tools.
 * Uses captured before-content + current disk state to produce hunk-level detail.
 *
 * @param afterContent - Optional explicit after-content for testing. When provided,
 *                       bypasses disk read (useful for unit tests with stub cache).
 */
function computeWrittenFiles(
  toolName: string,
  args: unknown | undefined,
  callId: string,
  cache: FileStateCache | undefined,
  worktreePath: string,
  afterContent?: string,
): import("../../../shared/rpc-types.ts").FileDiffPayload[] | undefined {
  const input = args as Record<string, unknown> | undefined;
  const filePath = typeof input?.file_path === "string" ? input.file_path : null;
  if (!filePath) return undefined;

  const lower = toolName.toLowerCase();
  if (lower !== "write" && lower !== "edit" && lower !== "multiedit") return undefined;

  const operation: import("../../../shared/rpc-types.ts").FileDiffPayload["operation"] =
    lower === "write" ? "write_file" : "edit_file";

  // Get captured before-content
  const before = cache?.get(callId);

  if (before === undefined) {
    // Not captured (e.g., non-write tool or cache not provided) — shallow fallback
    return [{ operation, path: filePath, added: 0, removed: 0 }];
  }

  // Determine after-content: explicit param > disk read
  let after: string;
  if (afterContent !== undefined) {
    after = afterContent;
  } else {
    // Read current file state (after tool execution)
    const absPath = worktreePath ? `${worktreePath}/${filePath}` : filePath;
    try {
      after = readFileSync(absPath, "utf-8");
    } catch {
      // File may have been deleted or unreadable
      after = "";
    }
  }

  // Compute diff
  const isNew = before === null;
  const payload = computeFileDiff(
    before ?? "",
    after,
    filePath,
    operation,
    isNew ? { isNew: true } : undefined,
  );

  // Release cache entry
  cache?.delete(callId);

  return [payload];
}

function buildClaudeBuiltinDisplay(name: string, input: Record<string, unknown>, worktreePath?: string): ToolCallDisplay {
  const str = (v: unknown): string => (v != null ? String(v) : "");
  switch (name.toLowerCase()) {
    case "bash":
      return {
        label: canonicalToolDisplayLabel(name),
        subject: stripWorktreePath(str(input.command || input.cmd) || undefined, worktreePath),
        contentType: "terminal",
      };
    case "read":
      return {
        label: canonicalToolDisplayLabel(name),
        subject: stripWorktreePath(str(input.file_path || input.path) || undefined, worktreePath),
        contentType: "file",
        startLine: typeof input.start_line === "number" && input.start_line > 0 ? input.start_line : undefined,
      };
    case "write":
      return { label: canonicalToolDisplayLabel(name), subject: stripWorktreePath(str(input.file_path) || undefined, worktreePath), contentType: "file" };
    case "edit":
    case "multiedit":
      return { label: canonicalToolDisplayLabel(name), subject: stripWorktreePath(str(input.file_path) || undefined, worktreePath), contentType: "file" };
    case "glob":
      return { label: canonicalToolDisplayLabel(name), subject: str(input.pattern) || undefined };
    case "grep":
    case "rg":
      return { label: canonicalToolDisplayLabel(name), subject: str(input.pattern) || undefined };
    case "ls":
      return { label: canonicalToolDisplayLabel(name), subject: stripWorktreePath(str(input.path) || undefined, worktreePath) };
    case "view":
      return { label: canonicalToolDisplayLabel(name), subject: stripWorktreePath(str(input.path) || undefined, worktreePath), contentType: "file" };
    case "webfetch":
    case "web_fetch":
      return { label: canonicalToolDisplayLabel(name), subject: str(input.url) || undefined };
    case "task":
      return { label: canonicalToolDisplayLabel(name), subject: str(input.description) || undefined };
    case "todowrite":
      return { label: canonicalToolDisplayLabel(name) };
    case "apply_patch":
      return { label: canonicalToolDisplayLabel(name) };
    case "create":
      return { label: canonicalToolDisplayLabel(name), subject: stripWorktreePath(str(input.path || input.name) || undefined, worktreePath), contentType: "file" };
    case "skill":
      return { label: canonicalToolDisplayLabel(name), subject: str(input.name) || undefined };
    case "store_memory":
      return { label: canonicalToolDisplayLabel(name) };
    default:
      return { label: humanizeToolName(name) };
  }
}

function isInternalClaudeToolName(toolName: string): boolean {
  if (!toolName) return false;
  if (toolName.startsWith("internal_") || toolName.startsWith("claude_")) return true;
  if (toolName === "report_intent") return true;
  return false;
}
