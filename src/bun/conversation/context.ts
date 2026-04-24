import { getDb } from "../db/index.ts";
import { getConfig } from "../config/index.ts";
import { log } from "../logger.ts";
import { resolveProvider, retryTurn } from "../ai/index.ts";
import type { AIMessage } from "../ai/types.ts";
import type { ConversationMessage, MessageType } from "../../shared/rpc-types.ts";
import type { ConversationMessageRow, TaskRow } from "../db/row-types.ts";
import { mapConversationMessage } from "../db/mappers.ts";
import { appendMessage } from "./messages.ts";
import { extractChips } from "../../mainview/utils/chat-chips.ts";

const TOOL_RESULT_MAX_CHARS = 8_000;
const TOOL_RESULT_LIMITS = new Map<string, number>([
  ["read_file", 100_000],
  ["search_text", 20_000],
  ["find_files", 10_000],
  ["run_command", 30_000],
  ["fetch_url", 100_000],
  ["spawn_agent", 100_000],
  ["edit_file", 2_000],
  ["write_file", 2_000],
  ["lsp", 100_000],
]);
const CONTEXT_WARN_FRACTION = 0.8;
const SYSTEM_MESSAGE_OVERHEAD_TOKENS = 400;
const COMPACTION_SYSTEM_PROMPT = `Your task is to create a detailed summary of the conversation so far, paying close attention to the user's explicit requests and your previous actions.
This summary should be thorough in capturing technical details, code patterns, and decisions that would be essential for continuing development work without losing context.

CRITICAL: Respond with TEXT ONLY. Do NOT call any tools. Your entire response must be an <analysis> block followed by a <summary> block.

Before providing your final summary, wrap your analysis in <analysis> tags to organize your thoughts:

1. Chronologically analyze each message and section of the conversation. For each section identify:
   - The user's explicit requests and intents
   - Your approach to addressing them
   - Key decisions, technical concepts, and code patterns
   - Specific details: file names, full code snippets, function signatures, file edits
   - Errors you ran into and how you fixed them
   - Specific user feedback, especially if the user told you to do something differently
2. Double-check for technical accuracy and completeness.

Your <summary> must include the following sections:

1. Primary Request and Intent: Capture all of the user's explicit requests and intents in detail
2. Key Technical Concepts: List all important technical concepts, technologies, and frameworks discussed
3. Files and Code Sections: Enumerate specific files and code sections examined, modified, or created. Include full code snippets where applicable and explain why each is important.
4. Errors and Fixes: List all errors encountered and how they were fixed. Include any specific user feedback received.
5. Problem Solving: Document problems solved and any ongoing troubleshooting efforts.
6. All User Messages: List ALL user messages verbatim (not paraphrased). These are critical for understanding user feedback and intent.
7. Pending Tasks: If an "## Active Todos" system block was injected into this conversation, do NOT re-enumerate those items here — they are persisted separately and will be re-injected fresh on the next call. Simply write: "Managed via todo system (see Active Todos block)." Only record pending items in prose here if no todo system block was present.
8. Current Work: Describe in detail precisely what was being worked on immediately before this summary, paying special attention to the most recent messages. Include file names and code snippets.
9. Optional Next Step: List the next step directly in line with the most recent work. IMPORTANT: only list a next step if it is explicitly in line with the user's most recent request. Include direct quotes from the most recent conversation showing exactly what task was being worked on.

Format your response exactly as:

<analysis>
[Your reasoning and analysis here]
</analysis>

<summary>
1. Primary Request and Intent:
   [Detail]

2. Key Technical Concepts:
   - [Concept]

3. Files and Code Sections:
   - [File name]
     - [Why important]
     - [Code snippet if applicable]

4. Errors and Fixes:
   - [Error description and fix]

5. Problem Solving:
   [Description]

6. All User Messages:
   - [Verbatim user message]

7. Pending Tasks:
   - [Task]

8. Current Work:
   [Detailed description with file names and snippets]

9. Optional Next Step:
   [Next step with direct quote if applicable]
</summary>`;

export const MICRO_COMPACT_TURN_WINDOW = 8;
export const MICRO_COMPACT_SENTINEL = "[tool result cleared — content no longer in active context]";
export const MICRO_COMPACT_CLEARABLE_TOOLS = new Set([
  "read_file",
  "run_command",
  "search_text",
  "find_files",
  "fetch_url",
  "edit_file",
  "patch_file",
]);

export function compactMessages(messages: ConversationMessageRow[], opts?: { quiet?: boolean }): AIMessage[] {
  const lastSummaryIdx = messages.map((message) => message.type).lastIndexOf("compaction_summary");
  let toProcess: ConversationMessageRow[];
  const prefixResult: AIMessage[] = [];
  if (lastSummaryIdx !== -1) {
    prefixResult.push({
      role: "system",
      content: `## Conversation Summary (earlier history compacted)\n\n${messages[lastSummaryIdx].content}`,
    });
    toProcess = messages.slice(lastSummaryIdx + 1);
  } else {
    toProcess = messages;
  }

  const turnOf = new Array(toProcess.length).fill(0);
  let microTurn = 0;
  let prevWasTool = false;
  for (let index = 0; index < toProcess.length; index++) {
    const type = toProcess[index].type;
    if (type === "tool_call") {
      if (!prevWasTool) microTurn++;
      prevWasTool = true;
    } else if (type === "tool_result") {
      prevWasTool = true;
    } else {
      prevWasTool = false;
    }
    turnOf[index] = microTurn;
  }
  const maxMicroTurn = microTurn;

  const result: AIMessage[] = [];
  const orphanedMessageIds: number[] = [];
  let index = 0;
  while (index < toProcess.length) {
    const message = toProcess[index];

    if (message.type === "user" || message.type === "assistant") {
      if (message.role !== "prompt") {
        const content = message.type === "user"
          ? extractChips(message.content).humanText
          : message.content;
        result.push({ role: message.role as "user" | "assistant", content });
      }
      index++;
      continue;
    }

    if (message.type === "system") {
      index++;
      continue;
    }

    if (message.type === "tool_call") {
      if (index + 1 >= toProcess.length || toProcess[index + 1].type !== "tool_result") {
        orphanedMessageIds.push(message.id);
        index++;
        continue;
      }

      let callContent: { name: string; arguments: string };
      try {
        callContent = JSON.parse(message.content);
      } catch {
        index++;
        continue;
      }

      let toolCallId = `call_${message.id}`;
      if (index + 1 < toProcess.length && toProcess[index + 1].type === "tool_result") {
        try {
          const metadata = JSON.parse(toProcess[index + 1].metadata ?? "{}") as { tool_call_id?: string };
          if (metadata.tool_call_id) toolCallId = metadata.tool_call_id;
        } catch {
          // keep fallback id
        }
      }

      const safeArgs = callContent.arguments && callContent.arguments.trim() !== "" ? callContent.arguments : "{}";
      result.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: toolCallId,
          type: "function",
          function: { name: callContent.name, arguments: safeArgs },
        }],
      } as AIMessage);
      index++;

      if (index < toProcess.length && toProcess[index].type === "tool_result") {
        let resultMeta: { tool_call_id?: string; name?: string } = {};
        try {
          resultMeta = JSON.parse(toProcess[index].metadata ?? "{}");
        } catch {
          // ignore malformed metadata
        }
        const toolName = resultMeta.name ?? callContent.name;
        const turnDistance = maxMicroTurn - turnOf[index];
        const shouldClear = MICRO_COMPACT_CLEARABLE_TOOLS.has(toolName) && turnDistance > MICRO_COMPACT_TURN_WINDOW;
        const toolLimit = TOOL_RESULT_LIMITS.get(toolName) ?? TOOL_RESULT_MAX_CHARS;
        const rawContent = toProcess[index].content.length > toolLimit
          ? `${toProcess[index].content.slice(0, toolLimit)}\n\n[truncated]`
          : toProcess[index].content;
        result.push({
          role: "tool",
          content: shouldClear ? MICRO_COMPACT_SENTINEL : rawContent,
          tool_call_id: resultMeta.tool_call_id ?? toolCallId,
          name: toolName,
        } as AIMessage);
        index++;
      }
      continue;
    }

    index++;
  }

  if (orphanedMessageIds.length > 0 && !opts?.quiet) {
    log("warn", `compactMessages: skipped ${orphanedMessageIds.length} orphaned tool_call(s) with no following tool_result (msg ids: ${orphanedMessageIds.join(", ")})`, {});
  }

  const collapsed: AIMessage[] = [...prefixResult];
  for (const message of result) {
    if (message.role === "user" && collapsed.length > 0 && collapsed[collapsed.length - 1].role === "user") {
      collapsed[collapsed.length - 1].content =
        `${collapsed[collapsed.length - 1].content as string}\n\n${message.content as string}`;
    } else {
      collapsed.push(message);
    }
  }
  return collapsed;
}

export function estimateContextUsage(
  taskId: number,
  maxTokens: number,
): { usedTokens: number; maxTokens: number; fraction: number } {
  const db = getDb();
  const recentExecution = db
    .query<{ input_tokens: number | null }, [number]>(
      "SELECT input_tokens FROM executions WHERE task_id = ? AND status = 'completed' AND input_tokens IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    .get(taskId);

  if (recentExecution?.input_tokens != null) {
    const usedTokens = recentExecution.input_tokens;
    const fraction = maxTokens > 0 ? Math.min(usedTokens / maxTokens, 1) : 0;
    return { usedTokens, maxTokens, fraction };
  }

  const messages = db
    .query<ConversationMessageRow, [number]>(
      "SELECT * FROM conversation_messages WHERE task_id = ? ORDER BY id ASC",
    )
    .all(taskId);

  const compacted = compactMessages(messages, { quiet: true });
  const totalChars = compacted.reduce((sum, message) => {
    if (typeof message.content === "string") return sum + message.content.length;
    return sum + JSON.stringify(message.content ?? "").length;
  }, 0);
  const usedTokens = Math.floor(totalChars / 4) + SYSTEM_MESSAGE_OVERHEAD_TOKENS;
  const fraction = maxTokens > 0 ? Math.min(usedTokens / maxTokens, 1) : 0;
  return { usedTokens, maxTokens, fraction };
}

export function estimateContextWarning(taskId: number, contextWindowOverride?: number): string | null {
  const contextWindowTokens = contextWindowOverride ?? 128_000;
  const warnAt = Math.floor(contextWindowTokens * CONTEXT_WARN_FRACTION);
  const { usedTokens } = estimateContextUsage(taskId, contextWindowTokens);
  if (usedTokens >= warnAt) {
    return `Context is ~${usedTokens.toLocaleString()} tokens (${Math.round((usedTokens / contextWindowTokens) * 100)}% of model limit). Consider archiving this task's conversation.`;
  }
  return null;
}

export async function resolveModelContextWindow(_qualifiedModel: string): Promise<number> {
  return 128_000;
}

export function extractSummaryBlock(raw: string): string {
  const match = raw.match(/<summary>([\s\S]*?)<\/summary>/i);
  return match?.[1]?.trim() ?? raw.trim();
}

export async function compactConversation(taskId: number): Promise<ConversationMessage> {
  const db = getDb();
  const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task?.conversation_id) throw new Error(`Task ${taskId} not found`);

  const config = getConfig();
  const resolvedModel = task.model ?? config.workspace.default_model ?? "";
  if (!resolvedModel) throw new Error(`Task ${taskId} has no model configured for compaction`);

  const { provider } = resolveProvider(resolvedModel, config.providers);
  const messages = db
    .query<ConversationMessageRow, [number]>(
      "SELECT * FROM conversation_messages WHERE task_id = ? ORDER BY id ASC",
    )
    .all(taskId);

  const compacted = compactMessages(messages, { quiet: true });
  const historyText = compacted
    .map((message) => {
      const role = message.role ?? "unknown";
      const content = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? "");
      return `${role.toUpperCase()}: ${content}`;
    })
    .join("\n\n");

  const result = await retryTurn(provider, [
    { role: "system", content: COMPACTION_SYSTEM_PROMPT },
    { role: "user", content: `<conversation>\n${historyText}</conversation>\n\nPlease summarize the conversation above.` },
  ], {}, 10, {}, "background");

  const rawSummary = result.type === "text" ? (result.content ?? "(empty summary)") : "(compaction failed)";
  const summary = extractSummaryBlock(rawSummary);
  const messageId = appendMessage(taskId, task.conversation_id, "compaction_summary" as MessageType, null, summary);
  const messageRow = db
    .query<ConversationMessageRow, [number]>("SELECT * FROM conversation_messages WHERE id = ?")
    .get(messageId)!;
  return mapConversationMessage(messageRow);
}
