import type { EngineEvent } from "../types.ts";
import type { ToolCallDisplay } from "../../../shared/rpc-types.ts";
import { COMMON_TOOL_NAMES, buildCommonToolDisplay } from "../common-tools.ts";
import { canonicalToolDisplayLabel } from "../tool-display.ts";

interface ClaudeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;  // tool_use blocks have an id
  name?: string;  // tool_use blocks have a name
  input?: Record<string, unknown>;  // tool_use blocks have input
  tool_use_id?: string;  // tool_result blocks reference a tool_use_id
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

export function translateClaudeMessage(message: ClaudeSdkMessage, toolMetaByCallId?: Map<string, ToolMetadata>): EngineEvent[] {
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
        if (block.type === "text" && block.text) {
          events.push({ type: "token", content: block.text });
        } else if (block.type === "thinking" && block.thinking) {
          events.push({ type: "reasoning", content: block.thinking });
        } else if (block.type === "tool_use" && block.id && block.name) {
          // Store tool metadata for later pairing with tool_result
          if (toolMetaByCallId) {
            toolMetaByCallId.set(block.id, {
              name: block.name,
              arguments: block.input,
            });
          }
          // Emit tool_start event with preserved callId
          events.push({
            type: "tool_start",
            callId: block.id,
            name: block.name,
            arguments: JSON.stringify(block.input ?? {}),
            isInternal: isInternalClaudeToolName(block.name),
            display: COMMON_TOOL_NAMES.has(block.name)
              ? buildCommonToolDisplay(block.name, block.input ?? {})
              : buildClaudeBuiltinDisplay(block.name, block.input ?? {}),
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
          events.push({
            type: "tool_result",
            callId: block.tool_use_id,
            name: toolName,
            result: block.content ?? "",
            isError: block.is_error ?? false,
            writtenFiles: extractWrittenFilesFromClaudeToolArgs(toolName, meta?.arguments),
          });

          // Clean up from map
          if (toolMetaByCallId) {
            toolMetaByCallId.delete(block.tool_use_id);
          }
        }
      }
      return events;
    }

    default:
      return [];
  }
}

function extractWrittenFilesFromClaudeToolArgs(
  toolName: string,
  args?: unknown,
): import("../../../shared/rpc-types.ts").FileDiffPayload[] | undefined {
  const input = args as Record<string, unknown> | undefined;
  const filePath = typeof input?.file_path === "string" ? input.file_path : null;
  if (!filePath) return undefined;
  const lower = toolName.toLowerCase();
  if (lower === "write") return [{ operation: "write_file", path: filePath, added: 0, removed: 0 }];
  if (lower === "edit" || lower === "multiedit") return [{ operation: "edit_file", path: filePath, added: 0, removed: 0 }];
  return undefined;
}

function buildClaudeBuiltinDisplay(name: string, input: Record<string, unknown>): ToolCallDisplay {
  const str = (v: unknown): string => (v != null ? String(v) : "");
  switch (name.toLowerCase()) {
    case "bash":
      return { label: canonicalToolDisplayLabel(name), subject: str(input.command || input.cmd) || undefined, contentType: "terminal" };
    case "read":
      return {
        label: canonicalToolDisplayLabel(name),
        subject: str(input.file_path || input.path) || undefined,
        contentType: "file",
        startLine: typeof input.start_line === "number" && input.start_line > 0 ? input.start_line : undefined,
      };
    case "write":
      return { label: canonicalToolDisplayLabel(name), subject: str(input.file_path) || undefined, contentType: "file" };
    case "edit":
    case "multiedit":
      return { label: canonicalToolDisplayLabel(name), subject: str(input.file_path) || undefined, contentType: "file" };
    case "glob":
      return { label: canonicalToolDisplayLabel(name), subject: str(input.pattern) || undefined };
    case "grep":
    case "rg":
      return { label: canonicalToolDisplayLabel(name), subject: str(input.pattern) || undefined };
    case "ls":
      return { label: canonicalToolDisplayLabel(name), subject: str(input.path) || undefined };
    case "view":
      return { label: canonicalToolDisplayLabel(name), subject: str(input.path) || undefined, contentType: "file" };
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
      return { label: canonicalToolDisplayLabel(name), subject: str(input.path || input.name) || undefined, contentType: "file" };
    case "skill":
      return { label: canonicalToolDisplayLabel(name), subject: str(input.name) || undefined };
    case "store_memory":
      return { label: canonicalToolDisplayLabel(name) };
    default:
      return { label: name };
  }
}

function isInternalClaudeToolName(toolName: string): boolean {
  if (!toolName) return false;
  if (toolName.startsWith("internal_") || toolName.startsWith("claude_")) return true;
  if (toolName === "report_intent") return true;
  return false;
}
