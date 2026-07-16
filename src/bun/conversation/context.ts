import type { Database } from "bun:sqlite";
import { noopLogger, type Logger } from "../logger.ts";
import type { AIMessage } from "../ai/types.ts";
import type { ConversationMessageRow } from "../db/row-types.ts";
import { extractChips } from "../../mainview/utils/chat-chips.ts";
import { resolveConversationMessageStore } from "./message-store-resolver.ts";

const TOOL_RESULT_MAX_CHARS = 8_000;
export const TOOL_RESULT_LIMITS = new Map<string, number>([
  ["read_file", 100_000],
  ["run_command", 30_000],
  ["fetch_url", 100_000],
  ["spawn_agent", 100_000],
  ["edit_file", 2_000],
  ["write_file", 2_000],
  ["lsp_go_to_definition", 100_000],
  ["lsp_find_references", 100_000],
  ["lsp_document_symbols", 100_000],
  ["lsp_workspace_symbols", 100_000],
  ["lsp_hover", 10_000],
  ["lsp_rename", 2_000],
  ["lsp_incoming_calls", 100_000],
  ["lsp_outgoing_calls", 100_000],
  ["lsp_diagnostics", 100_000],
  ["lsp_type_definition", 100_000],
]);
const CONTEXT_WARN_FRACTION = 0.8;
const SYSTEM_MESSAGE_OVERHEAD_TOKENS = 400;
export const MICRO_COMPACT_TURN_WINDOW = 8;
export const MICRO_COMPACT_SENTINEL = "[tool result cleared — content no longer in active context]";
export const MICRO_COMPACT_CLEARABLE_TOOLS = new Set([
  "read_file",
  "run_command",
  "fetch_url",
  "edit_file",
  "patch_file",
]);

export function compactMessages(messages: ConversationMessageRow[], opts?: { logger?: Logger }): AIMessage[] {
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

  if (orphanedMessageIds.length > 0) {
    (opts?.logger ?? noopLogger).log("warn", `compactMessages: skipped ${orphanedMessageIds.length} orphaned tool_call(s) with no following tool_result (msg ids: ${orphanedMessageIds.join(", ")})`, {});
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

export async function estimateContextUsage(
  db: Database,
  taskId: number,
  maxTokens: number,
): Promise<{ usedTokens: number; maxTokens: number; fraction: number }> {
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

  const taskRow = db
    .query<{ conversation_id: number | null }, [number]>("SELECT conversation_id FROM tasks WHERE id = ?")
    .get(taskId);
  if (taskRow?.conversation_id == null) {
    return { usedTokens: SYSTEM_MESSAGE_OVERHEAD_TOKENS, maxTokens, fraction: 0 };
  }

  const store = resolveConversationMessageStore(db, taskRow.conversation_id);
  const messages = await store.getAll();

  const compacted = compactMessages(messages, { logger: noopLogger });
  const totalChars = compacted.reduce((sum, message) => {
    if (typeof message.content === "string") return sum + message.content.length;
    return sum + JSON.stringify(message.content ?? "").length;
  }, 0);
  const usedTokens = Math.floor(totalChars / 4) + SYSTEM_MESSAGE_OVERHEAD_TOKENS;
  const fraction = maxTokens > 0 ? Math.min(usedTokens / maxTokens, 1) : 0;
  return { usedTokens, maxTokens, fraction };
}

export async function estimateContextWarning(db: Database, taskId: number, contextWindowOverride?: number): Promise<string | null> {
  const contextWindowTokens = contextWindowOverride ?? 128_000;
  const warnAt = Math.floor(contextWindowTokens * CONTEXT_WARN_FRACTION);
  const { usedTokens } = await estimateContextUsage(db, taskId, contextWindowTokens);
  if (usedTokens >= warnAt) {
    return `Context is ~${usedTokens.toLocaleString()} tokens (${Math.round((usedTokens / contextWindowTokens) * 100)}% of model limit). Consider archiving this task's conversation.`;
  }
  return null;
}

export async function resolveModelContextWindow(_qualifiedModel: string): Promise<number> {
  return 128_000;
}
