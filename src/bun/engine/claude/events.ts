import type { EngineEvent } from "../types.ts";
import type { ToolCallDisplay } from "../../../shared/rpc-types.ts";
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
  /** SDK 0.3.x: sidecar with display-friendly names and icon URLs for tool calls. */
  tool_use_meta?: {
    name?: string;
    icon_url?: string;
  };
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
  options?: { toolMetaByCallId?: Map<string, ToolMetadata>; worktreePath?: string },
): EngineEvent[] {
  const toolMetaByCallId = options?.toolMetaByCallId;
  const worktreePath = options?.worktreePath;

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
          // Build display: prefer tool_use_meta icon_url for MCP tools, fallback to built-in builder
          const iconUrl = block.tool_use_meta?.icon_url;
          const display = COMMON_TOOL_NAMES.has(resolvedName)
            ? buildCommonToolDisplay(resolvedName, block.input ?? {})
            : { ...buildClaudeBuiltinDisplay(resolvedName, block.input ?? {}, worktreePath), iconUrl };
          // Emit tool_start event with preserved callId
          events.push({
            type: "tool_start",
            callId: block.id,
            name: resolvedName,
            arguments: JSON.stringify(block.input ?? {}),
            isInternal: isInternalClaudeToolName(resolvedName),
            display,
          });
        }
      }
      return events;
    }

    case "result": {
      const result = message as ClaudeResultMessage;
      const events: EngineEvent[] = [];

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

          events.push({
            type: "tool_result",
            callId: block.tool_use_id,
            name: toolName,
            result: normalizedContent,
            detailedResult,
            isError: block.is_error ?? false,
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
