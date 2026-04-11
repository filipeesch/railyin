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
}

type ClaudeSdkMessage = ClaudeAssistantMessage | ClaudeResultMessage | ClaudeSystemMessage | { type: string; [key: string]: unknown };

export function translateClaudeMessage(message: ClaudeSdkMessage): EngineEvent[] {
  switch (message.type) {
    case "assistant": {
      const events: EngineEvent[] = [];
      for (const block of message.message?.content ?? []) {
        if (block.type === "text" && block.text) {
          events.push({ type: "token", content: block.text });
        } else if (block.type === "thinking" && block.thinking) {
          events.push({ type: "reasoning", content: block.thinking });
        }
      }
      return events;
    }

    case "result": {
      const events: EngineEvent[] = [];
      if (message.usage) {
        events.push({
          type: "usage",
          inputTokens: message.usage.input_tokens ?? 0,
          outputTokens: message.usage.output_tokens ?? 0,
        });
      }

      if (message.subtype === "success") {
        events.push({ type: "done" });
      } else {
        events.push({
          type: "error",
          message: message.errors?.join("\n") || message.error || `Claude execution failed (${message.subtype ?? "unknown"})`,
          fatal: true,
        });
      }
      return events;
    }

    case "system":
      if (message.summary) {
        return [{ type: "status", message: message.summary }];
      }
      return [];

    default:
      return [];
  }
}
