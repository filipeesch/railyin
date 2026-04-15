import type { EngineEvent } from "../types.ts";

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

type ClaudeSdkMessage = ClaudeAssistantMessage | ClaudeResultMessage | ClaudeSystemMessage | { type: string; [key: string]: unknown };

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
      if (system.subtype === "compaction_summary" && system.summary) {
        // Surface context window compaction to user
        return [{ type: "status", message: `Context window compacted using conversation summary: ${system.summary}` }];
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

function isInternalClaudeToolName(toolName: string): boolean {
  if (!toolName) return false;
  if (toolName.startsWith("internal_") || toolName.startsWith("claude_")) return true;
  if (toolName === "report_intent") return true;
  return false;
}
