import type { EngineEvent } from "../types.ts";

interface ClaudeContentBlock {
  type: string;
  text?: string;
  thinking?: string;
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

type ClaudeSdkMessage = ClaudeAssistantMessage | ClaudeResultMessage | ClaudeSystemMessage | { type: string; [key: string]: unknown };

export function translateClaudeMessage(message: ClaudeSdkMessage): EngineEvent[] {
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
        }
      }
      return events;
    }

    case "result": {
      const result = message as ClaudeResultMessage;
      const events: EngineEvent[] = [];
      if (result.usage) {
        events.push({
          type: "usage",
          inputTokens: result.usage.input_tokens ?? 0,
          outputTokens: result.usage.output_tokens ?? 0,
        });
      }

      if (result.subtype === "success") {
        events.push({ type: "done" });
      } else {
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
      if (typeof system.status === "string" && system.status.trim()) {
        return [{ type: "status", message: system.status }];
      }
      if (system.summary) {
        return [{ type: "status", message: system.summary }];
      }
      return [];
    }

    default:
      return [];
  }
}
