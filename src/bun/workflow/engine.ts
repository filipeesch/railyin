import { getDb } from "../db/index.ts";
import { getProjectById } from "../project-store.ts";
import { getConfig } from "../config/index.ts";
import { log } from "../logger.ts";
import { resolveProvider, UnresolvableProviderError, listOpenAICompatibleModels, retryStream, retryTurn } from "../ai/index.ts";
import type { AIMessage, AIToolCall } from "../ai/types.ts";
import {
  readSessionMemory,
  extractSessionMemory,
  formatSessionNotesBlock,
  SESSION_MEMORY_EXTRACTION_INTERVAL,
} from "./session-memory.ts";
import type { Task, ConversationMessage, MessageType } from "../../shared/rpc-types.ts";
import type { TaskRow, ConversationMessageRow, TaskGitContextRow } from "../db/row-types.ts";
import { mapTask, mapConversationMessage } from "../db/mappers.ts";
import { resolveToolsForColumn, getToolDescriptionBlock, executeTool, type WriteResult, type TaskToolCallbacks } from "./tools.ts";
import { LSPServerManager } from "../lsp/manager.ts";
import { formatReviewMessageForLLM } from "./review.ts";
import { resolveSlashReference } from "./slash-prompt.ts";
import { listTodos } from "../db/todos.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

// Task 5.5: Tool results larger than this (in chars, ~1 token ≈ 4 chars) are truncated
const TOOL_RESULT_MAX_CHARS = 8_000; // default for tools not in TOOL_RESULT_LIMITS

/** Per-tool result size limits in chars. Tools not listed fall back to TOOL_RESULT_MAX_CHARS. */
const TOOL_RESULT_LIMITS = new Map<string, number>([
  ["read_file", 100_000],       // ~25,000 tokens — large files need full content
  ["search_text", 20_000],      // ripgrep output
  ["find_files", 10_000],       // file listing
  ["run_command", 30_000],      // command output (matches Free Code's bash limit)
  ["fetch_url", 100_000],       // web page content
  ["spawn_agent", 100_000],     // sub-agent results can be large
  ["edit_file", 2_000],         // just a confirmation message
  ["write_file", 2_000],        // just a confirmation message
  ["lsp", 100_000],             // LSP results (definition, references, symbols)
]);

// Task 5.6: Warn when assembled context exceeds this fraction of the context window
const CONTEXT_WARN_FRACTION = 0.8;

// ─── Micro-compact constants ─────────────────────────────────────────────────
// Tool results beyond this many turns old are replaced with a sentinel string
// in the assembled payload (DB is never modified).
export const MICRO_COMPACT_TURN_WINDOW = 8;
export const MICRO_COMPACT_SENTINEL = "[tool result cleared — content no longer in active context]";
export const MICRO_COMPACT_CLEARABLE_TOOLS = new Set([
  "read_file",
  "run_command",
  "search_text",
  "find_files",
  "fetch_url",
  "edit_file",
  "patch_file", // backward compat: clear old patch_file results in stored conversations
]);

// ─── Streaming callback type ──────────────────────────────────────────────────

export type OnToken = (taskId: number, executionId: number, token: string, done: boolean, isReasoning?: boolean, isStatus?: boolean) => void;
export type OnError = (taskId: number, executionId: number, error: string) => void;
export type OnTaskUpdated = (task: Task) => void;
export type OnNewMessage = (message: ConversationMessage) => void;

// ─── Cancellation map ─────────────────────────────────────────────────────────
// Keyed by executionId. Populated at execution start, removed on finish.

const executionControllers = new Map<number, AbortController>();

export function cancelExecution(executionId: number): void {
  const controller = executionControllers.get(executionId);
  if (controller) {
    controller.abort();
    return;
  }
  // No live controller — zombie cleanup: mark orphaned execution failed and unblock the task.
  const db = getDb();
  const execRow = db.query<{ task_id: number; status: string; finished_at: string | null }, [number]>(
    "SELECT task_id, status, finished_at FROM executions WHERE id = ?",
  ).get(executionId);
  if (execRow && execRow.status === "running" && execRow.finished_at == null) {
    db.run("UPDATE executions SET status = 'failed', finished_at = datetime('now') WHERE id = ?", [executionId]);
    db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [execRow.task_id]);
  }
}

// ─── Shell approval pending map ───────────────────────────────────────────────
// Keyed by taskId. Holds the resolver for in-flight approval prompts.

type ShellApprovalDecision = "approve_once" | "approve_all" | "deny";
const pendingShellApprovals = new Map<number, (decision: ShellApprovalDecision) => void>();

export function getApprovedCommands(taskId: number): string[] {
  const db = getDb();
  const row = db.query<{ approved_commands: string }, [number]>(
    "SELECT approved_commands FROM tasks WHERE id = ?",
  ).get(taskId);
  try { return JSON.parse(row?.approved_commands ?? "[]"); } catch { return []; }
}

export function appendApprovedCommands(taskId: number, binaries: string[]): void {
  const current = getApprovedCommands(taskId);
  const updated = [...new Set([...current, ...binaries])];
  const db = getDb();
  db.run("UPDATE tasks SET approved_commands = ? WHERE id = ?", [JSON.stringify(updated), taskId]);
}

export function resolveShellApproval(taskId: number, decision: ShellApprovalDecision, onTaskUpdated: OnTaskUpdated): boolean {
  const resolve = pendingShellApprovals.get(taskId);
  if (!resolve) return false;
  pendingShellApprovals.delete(taskId);
  // Flip execution_state back to running before the promise resolves so the
  // frontend reflects the resumed state before tool output arrives.
  const db = getDb();
  db.run("UPDATE tasks SET execution_state = 'running' WHERE id = ?", [taskId]);
  const runRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (runRow) onTaskUpdated(mapTask(runRow));
  resolve(decision);
  return true;
}

// ─── Helper: get column config ────────────────────────────────────────────────

function getColumnConfig(templateId: string, columnId: string) {
  const config = getConfig();
  const template = config.workflows.find((w) => w.id === templateId);
  return template?.columns.find((c) => c.id === columnId) ?? null;
}

function getBoardTemplateId(boardId: number): string {
  const db = getDb();
  const board = db
    .query<{ workflow_template_id: string }, [number]>(
      "SELECT workflow_template_id FROM boards WHERE id = ?",
    )
    .get(boardId);
  return board?.workflow_template_id ?? "delivery";
}

/**
 * Safety-net filter: returns true when the model response is empty or contains
 * tool-call syntax emitted as raw text (XML `<tool_call>`, JSON fences, bare JSON blobs).
 * With unified streaming, the model always calls tools via the structured API;
 * this guard protects against edge-case model misbehaviour and avoids poisoning history.
 */
function isBadAssistantResponse(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed === "") return true;
  // JSON tool-call blob in markdown code fence (```json { "name": ...)
  if (/```(?:json)?\s*\{\s*"name"\s*:/.test(trimmed)) return true;
  // Bare JSON tool-call at end of response (no fence)
  if (/\{\s*"name"\s*:\s*"[a-z_]+"\s*,\s*"arguments"/.test(trimmed.slice(-300))) return true;
  return false;
}

/**
 * Strip XML tool-call blocks (`<tool_call>...</tool_call>`) from a response.
 * Returns { clean, hadToolCalls }.
 * `clean` is the text with all tool-call blocks removed and excess whitespace collapsed.
 * `hadToolCalls` is true when at least one block was found.
 */
function stripXmlToolCalls(text: string): { clean: string; hadToolCalls: boolean } {
  const hadToolCalls = text.includes("<tool_call>");
  const clean = text.replace(/<tool_call>[\s\S]*?<\/tool_call>/g, "").replace(/\n{3,}/g, "\n\n").trim();
  return { clean, hadToolCalls };
}



export function compactMessages(messages: ConversationMessageRow[], opts?: { quiet?: boolean }): AIMessage[] {
  // If a compaction_summary exists, use the most recent one as the history baseline:
  // inject it as a system message and only process messages that came after it.
  const lastSummaryIdx = messages.map((m) => m.type).lastIndexOf("compaction_summary");
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

  // ─── Micro-compact: assign an assistant-turn index to each message ──────────
  // Two consecutive tool_call/tool_result pairs share the same turn index.
  // A new turn starts only when a tool_call follows a non-tool message, or
  // when an assistant text message appears.
  const turnOf = new Array(toProcess.length).fill(0);
  let microTurn = 0;
  let prevWasTool = false;
  for (let j = 0; j < toProcess.length; j++) {
    const t = toProcess[j].type;
    if (t === "tool_call") {
      if (!prevWasTool) microTurn++;
      prevWasTool = true;
    } else if (t === "tool_result") {
      prevWasTool = true; // same round as preceding tool_call
    } else {
      prevWasTool = false;
    }
    turnOf[j] = microTurn;
  }
  const maxMicroTurn = microTurn;

  const result: AIMessage[] = [];
  const orphanedMsgIds: number[] = [];
  let i = 0;
  while (i < toProcess.length) {
    const m = toProcess[i];

    if (m.type === "user" || m.type === "assistant") {
      // role='prompt' is a slash-command injection — skip it entirely.
      // Anthropic's adaptMessages() was already silently dropping these (only
      // pushes role=user|assistant). OpenAI-compat rejects role='prompt' with 400.
      if (m.role !== "prompt") {
        result.push({ role: m.role as "user" | "assistant", content: m.content });
      }
      i++;
      continue;
    }

    // system messages (UI markers like "Running prompt: plan") are excluded from
    // LLM context — they are display-only artifacts, not conversation turns.
    if (m.type === "system") {
      i++;
      continue;
    }

    // tool_call rows: reconstruct as an OpenAI-format assistant message with
    // tool_calls array, then consume the paired tool_result(s).
    if (m.type === "tool_call") {
      // Orphaned tool_call: no following tool_result (execution was interrupted after
      // the tool_call row was written but before the result was stored). Emitting an
      // assistant+tool_calls message with no matching tool message causes an Anthropic
      // 400 on every retry, permanently sticking the task. Skip silently and warn.
      if (i + 1 >= toProcess.length || toProcess[i + 1].type !== "tool_result") {
        orphanedMsgIds.push(m.id);
        i++;
        continue;
      }
      // Collect all consecutive tool_call messages in this round (they may be
      // stored interleaved with their results when roundCalls has multiple calls).
      // Strategy: gather all consecutive tool_call + tool_result pairs as
      // individual paired assistant+tool turns (valid for OpenAI-compat APIs).
      let callContent: { name: string; arguments: string };
      try {
        callContent = JSON.parse(m.content);
      } catch {
        i++;
        continue;
      }
      // Find the tool_call_id from the next tool_result's metadata
      let toolCallId = `call_${m.id}`;
      if (i + 1 < toProcess.length && toProcess[i + 1].type === "tool_result") {
        try {
          const meta = JSON.parse(toProcess[i + 1].metadata ?? "{}") as { tool_call_id?: string };
          if (meta.tool_call_id) toolCallId = meta.tool_call_id;
        } catch { /* keep default */ }
      }
      // Ensure arguments is always a valid JSON string (empty string → "{}") so
      // OpenAI-compatible servers don't return 500 on malformed tool_calls.
      const safeArgs = callContent.arguments && callContent.arguments.trim() !== ""
        ? callContent.arguments
        : "{}";
      result.push({
        role: "assistant",
        content: null,
        tool_calls: [{
          id: toolCallId,
          type: "function",
          function: { name: callContent.name, arguments: safeArgs },
        }],
      } as AIMessage);
      i++;
      // Consume the paired tool_result
      if (i < toProcess.length && toProcess[i].type === "tool_result") {
        let resultMeta: { tool_call_id?: string; name?: string } = {};
        try { resultMeta = JSON.parse(toProcess[i].metadata ?? "{}"); } catch { /* ok */ }
        const toolName = resultMeta.name ?? callContent.name;
        const turnDistance = maxMicroTurn - turnOf[i];
        const shouldClear =
          MICRO_COMPACT_CLEARABLE_TOOLS.has(toolName) &&
          turnDistance > MICRO_COMPACT_TURN_WINDOW;
        const toolLimit = TOOL_RESULT_LIMITS.get(toolName) ?? TOOL_RESULT_MAX_CHARS;
        const rawContent = toProcess[i].content.length > toolLimit
          ? toProcess[i].content.slice(0, toolLimit) + "\n\n[truncated]"
          : toProcess[i].content;
        result.push({
          role: "tool",
          content: shouldClear ? MICRO_COMPACT_SENTINEL : rawContent,
          tool_call_id: resultMeta.tool_call_id ?? toolCallId,
          name: toolName,
        } as AIMessage);
        i++;
      }
      continue;
    }

    // Orphaned tool_result with no preceding tool_call — skip
    if (m.type === "tool_result") {
      i++;
      continue;
    }

    // file_diff, code_review, ask_user_prompt, interview_prompt, transition_event, artifact_event, reasoning — excluded
    i++;
  }

  if (orphanedMsgIds.length > 0 && !opts?.quiet) {
    log("warn", `compactMessages: skipped ${orphanedMsgIds.length} orphaned tool_call(s) with no following tool_result (msg ids: ${orphanedMsgIds.join(", ")})`, {});
  }

  // Collapse consecutive user messages — caused by failed retries where the
  // system error messages between them are excluded. Models like Qwen3 require
  // strict user/assistant alternation; consecutive user turns cause a Jinja
  // template error ("No user query found in messages").
  const collapsed: AIMessage[] = [...prefixResult];
  for (const msg of result) {
    if (
      msg.role === "user" &&
      collapsed.length > 0 &&
      collapsed[collapsed.length - 1].role === "user"
    ) {
      // Merge into the previous user message
      collapsed[collapsed.length - 1].content =
        (collapsed[collapsed.length - 1].content as string) + "\n\n" + (msg.content as string);
    } else {
      collapsed.push(msg);
    }
  }
  return collapsed;
}

// ─── Task 5.4 + 6.5: Assemble messages for AI call ──────────────────────────

type GitContext = Pick<TaskGitContextRow, "git_root_path" | "worktree_path" | "worktree_status"> & {
  project_path: string;
};

function assembleMessages(
  task: TaskRow,
  stageInstructions: string | undefined,
  history: ConversationMessageRow[],
  newMessage: string,
  gitContext?: GitContext,
  sessionNotes?: string | null,
  taskId?: number,
  columnTools?: string[],
): AIMessage[] {
  const messages: AIMessage[] = [];

  // Always inject stage_instructions as first system message
  if (stageInstructions) {
    messages.push({ role: "system", content: stageInstructions });
  }

  // Task title and description — critical context the model needs to know what
  // it is working on ("create a plan for this task" needs to know what the task is).
  const taskLines = [`## Task`, `**Title:** ${task.title}`];
  if (task.description?.trim()) {
    taskLines.push(`**Description:** ${task.description.trim()}`);
  }
  messages.push({ role: "system", content: taskLines.join("\n") });
  if (gitContext?.worktree_status === "ready" && gitContext.worktree_path) {
    const lines = [
      "## Worktree context",
      `You are working inside a dedicated Git worktree for this task.`,
      `- worktree_path: ${gitContext.worktree_path}`,
      `- git_root_path: ${gitContext.git_root_path}`,
      `- project_path:  ${gitContext.project_path}`,
      "",
      getToolDescriptionBlock(columnTools),
    ];
    messages.push({ role: "system", content: lines.join("\n") });
  }

  // Active todos — inject as a system block so the list survives compaction.
  // Only id/title/status are injected.
  if (taskId) {
    const todos = listTodos(taskId);
    if (todos.length > 0) {
      const STATUS_ICON: Record<string, string> = {
        "completed": "✓",
        "in-progress": "●",
        "not-started": "○",
      };
      const lines = ["## Active Todos", ""];
      for (const t of todos) {
        const icon = STATUS_ICON[t.status] ?? "○";
        lines.push(`[${t.id}] ${icon}  ${t.title}`);
      }
      messages.push({ role: "system", content: lines.join("\n") });
    }
  }

  // Compacted conversation history
  const compacted = compactMessages(history);

  // If the compacted history begins with an assistant message, the conversation
  // was initiated by a workflow on_enter_prompt that was never persisted to DB
  // (only used in-memory for the LLM call). Re-inject that prompt as the opening
  // user turn so models like Qwen3 (which require strict user/assistant alternation)
  // don't error with "No user query found in messages".
  if (compacted.length > 0 && compacted[0].role !== "user") {
    compacted.unshift({ role: "user", content: newMessage });
  }

  messages.push(...compacted);

  // The triggering message — handle three cases to avoid consecutive user messages
  // (Qwen3's Jinja template requires strict user/assistant alternation):
  //   1. newMessage already at end of history (handleHumanTurn stores in DB before calling
  //      runExecution, so compactMessages includes it) — skip the push entirely.
  //   2. Last compacted message is user but content differs (on_enter_prompt from handleRetry
  //      or handleTransition) — merge to avoid consecutive user turns.
  //   3. Last compacted message is not user — push normally.
  const lastMsg = messages[messages.length - 1];
  if (lastMsg?.role === "user") {
    const lastContent = lastMsg.content as string;
    const alreadyPresent =
      lastContent === newMessage || lastContent.endsWith("\n\n" + newMessage);
    if (!alreadyPresent) {
      lastMsg.content = lastContent + "\n\n" + newMessage;
    }
  } else {
    messages.push({ role: "user", content: newMessage });
  }

  // Session notes — appended to the final user message as a <session_context> block.
  // Keeping variable content OUT of the stable system prefix prevents cache invalidation
  // when extractSessionMemory() updates notes every SESSION_MEMORY_EXTRACTION_INTERVAL turns.
  if (sessionNotes) {
    const finalMsg = messages[messages.length - 1];
    if (finalMsg?.role === "user") {
      finalMsg.content = (finalMsg.content as string) + formatSessionNotesBlock(sessionNotes);
    }
  }

  return messages;
}

// ─── Task 5.6: Context size warning ──────────────────────────────────────────

// Approximate overhead of injected system messages (stage_instructions + worktree context + task block)
// These are not stored in DB but are always included in the assembled context.
const SYSTEM_MESSAGE_OVERHEAD_TOKENS = 400;

export function estimateContextUsage(
  taskId: number,
  maxTokens: number,
): { usedTokens: number; maxTokens: number; fraction: number } {
  const db = getDb();

  // Use actual input_tokens from the most recent completed execution when available.
  // Only completed executions are used to avoid reading partial values from an
  // in-flight stream (which may have outputTokens=0 from the early message_start event).
  const recentExec = db
    .query<{ input_tokens: number | null }, [number]>(
      "SELECT input_tokens FROM executions WHERE task_id = ? AND status = 'completed' AND input_tokens IS NOT NULL ORDER BY id DESC LIMIT 1",
    )
    .get(taskId);

  if (recentExec?.input_tokens != null) {
    const usedTokens = recentExec.input_tokens;
    const fraction = maxTokens > 0 ? Math.min(usedTokens / maxTokens, 1) : 0;
    return { usedTokens, maxTokens, fraction };
  }

  // Fallback: character-count estimation when no actual usage is recorded yet.
  const messages = db
    .query<ConversationMessageRow, [number]>(
      "SELECT * FROM conversation_messages WHERE task_id = ? ORDER BY id ASC",
    )
    .all(taskId);

  // Use compactMessages() so the estimate reflects post-decay content sizes
  // (micro-compact clears old tool results, reducing the effective token count).
  // quiet=true to suppress orphan warnings — context gauge polls frequently.
  const compacted = compactMessages(messages, { quiet: true });
  const totalChars = compacted.reduce((sum, m) => {
    if (typeof m.content === "string") return sum + m.content.length;
    return sum + JSON.stringify(m.content ?? "").length;
  }, 0);
  const usedTokens = Math.floor(totalChars / 4) + SYSTEM_MESSAGE_OVERHEAD_TOKENS;
  const fraction = maxTokens > 0 ? Math.min(usedTokens / maxTokens, 1) : 0;
  return { usedTokens, maxTokens, fraction };
}

export function estimateContextWarning(taskId: number, contextWindowOverride?: number): string | null {
  const db = getDb();
  const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) return null;

  let contextWindowTokens: number;
  if (contextWindowOverride != null) {
    contextWindowTokens = contextWindowOverride;
  } else {
    const config = getConfig();
    // Resolve fallback context window from task's provider config
    const qualifiedModel = task.model ?? "";
    const provId = qualifiedModel.split("/")[0];
    const provConfig = config.providers.find((p) => p.id === provId);
    contextWindowTokens = provConfig?.context_window_tokens ?? 128_000;
  }
  const warnAt = Math.floor(contextWindowTokens * CONTEXT_WARN_FRACTION);

  const { usedTokens } = estimateContextUsage(taskId, contextWindowTokens);

  if (usedTokens >= warnAt) {
    return `Context is ~${usedTokens.toLocaleString()} tokens (${Math.round((usedTokens / contextWindowTokens) * 100)}% of model limit). Consider archiving this task's conversation.`;
  }
  return null;
}

// ─── Helper: append message to conversation ───────────────────────────────────

export function appendMessage(
  taskId: number,
  conversationId: number,
  type: MessageType,
  role: string | null,
  content: string,
  metadata?: Record<string, unknown>,
): number {
  const db = getDb();
  const result = db.run(
    `INSERT INTO conversation_messages (task_id, conversation_id, type, role, content, metadata)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [taskId, conversationId, type, role, content, metadata ? JSON.stringify(metadata) : null],
  );
  return result.lastInsertRowid as number;
}

export function ensureTaskConversation(taskId: number, conversationId: number | null): number {
  const db = getDb();

  if (conversationId != null) {
    const existing = db
      .query<{ id: number }, [number, number]>(
        "SELECT id FROM conversations WHERE id = ? AND task_id = ?",
      )
      .get(conversationId, taskId);
    if (existing) return conversationId;
  }

  const convResult = db.run("INSERT INTO conversations (task_id) VALUES (?)", [taskId]);
  const ensuredConversationId = convResult.lastInsertRowid as number;
  db.run("UPDATE tasks SET conversation_id = ? WHERE id = ?", [ensuredConversationId, taskId]);
  return ensuredConversationId;
}

// ─── Conversation compaction ──────────────────────────────────────────────────

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

/**
 * Fetch context_length for a qualified model from the provider API.
 * model is a fully-qualified model ID like "lmstudio/qwen3-8b".
 * Falls back to the provider's config override, then 128k.
 */
export async function resolveModelContextWindow(qualifiedModel: string): Promise<number> {
  const config = getConfig();
  const slashIdx = qualifiedModel.indexOf("/");
  const providerId = slashIdx !== -1 ? qualifiedModel.slice(0, slashIdx) : "";
  const modelId = slashIdx !== -1 ? qualifiedModel.slice(slashIdx + 1) : qualifiedModel;
  const provConfig = config.providers.find((p) => p.id === providerId);
  const fallback = provConfig?.context_window_tokens ?? 128_000;

  if (!provConfig) return fallback;

  // Anthropic: fetch from /v1/models
  if (provConfig.type === "anthropic") {
    try {
      const res = await fetch("https://api.anthropic.com/v1/models", {
        headers: { "x-api-key": provConfig.api_key ?? "", "anthropic-version": "2023-06-01" },
      });
      if (res.ok) {
        const json = await res.json() as { data?: Array<{ id: string; context_window?: number }> };
        const found = (json.data ?? []).find((m) => m.id === modelId);
        if (found?.context_window) return found.context_window;
      }
    } catch { /* fall through */ }
    return fallback;
  }

  // OpenAI-compatible providers (LM Studio, OpenRouter, Ollama, etc.)
  const models = await listOpenAICompatibleModels(provConfig);
  const found = models.find((m) => m.id === modelId);
  if (found && found.contextWindow !== null) return found.contextWindow;

  return fallback;
}

/**
 * Extracts the content of the <summary> block from a compaction response.
 * If a <summary>...</summary> block is present, returns only its inner content.
 * Falls back to the full response when no tags are detected (e.g. smaller models
 * that ignore the format instruction), so storage never errors out.
 */
export function extractSummaryBlock(raw: string): string {
  const match = raw.match(/<summary>([\s\S]*?)<\/summary>/i);
  if (match) return match[1].trim();
  // No <summary> tags — strip any <analysis> block that may be present and return the rest.
  const withoutAnalysis = raw.replace(/<analysis>[\s\S]*?<\/analysis>/gi, "").trim();
  return withoutAnalysis || raw;
}

export async function compactConversation(taskId: number): Promise<ConversationMessage> {
  const db = getDb();
  const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const history = db
    .query<ConversationMessageRow, [number]>(
      "SELECT * FROM conversation_messages WHERE task_id = ? ORDER BY id ASC",
    )
    .all(taskId);

  const config = getConfig();
  const resolvedModel = task.model ?? null;
  if (!resolvedModel) throw new Error("No model configured for this task. Select a model first.");
  const { provider } = resolveProvider(resolvedModel, config.providers);

  // Render history as plain text to avoid Jinja template issues (tool_call/tool role
  // sequences can't be sent to models with strict chat templates like Qwen3).
  const lines = history
    .filter((m) => !["transition_event", "compaction_summary", "reasoning", "interview_prompt"].includes(m.type))
    .map((m) => {
      const label = m.role ?? m.type;
      const content = m.type === "tool_call"
        ? (() => { try { const c = JSON.parse(m.content) as { name?: string; arguments?: string }; return `[tool: ${c.name}] ${c.arguments ?? ""}`; } catch { return m.content; } })()
        : m.content;
      return `[${label}]: ${content}`;
    });

  const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

  const buildMessages = (maxWords: number): { callMessages: AIMessage[]; totalWords: number; truncated: boolean } => {
    let historyText = "";
    let totalWords = 0;
    let truncated = false;
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i] + "\n\n";
      const w = wordCount(line);
      if (totalWords + w > maxWords) { truncated = true; break; }
      historyText = line + historyText;
      totalWords += w;
    }
    if (truncated) historyText = "[… earlier messages omitted …]\n\n" + historyText;
    return {
      callMessages: [
        { role: "system", content: COMPACTION_SYSTEM_PROMPT },
        { role: "user", content: `<conversation>\n${historyText}</conversation>\n\nPlease summarize the conversation above.` },
      ],
      totalWords,
      truncated,
    };
  };

  // Start with API-reported context window. If the model is loaded with a smaller
  // n_ctx (common in LM Studio), the API returns 400. Retry with halved budget.
  const contextWindow = await resolveModelContextWindow(resolvedModel);
  const RESERVED_TOKENS = 500;
  let maxWords = Math.floor((contextWindow - RESERVED_TOKENS) / 1.3);
  const MAX_RETRIES = 5;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const { callMessages, totalWords, truncated } = buildMessages(maxWords);
    log("info", `compaction: attempt ${attempt}`, { taskId, data: { model: resolvedModel, contextWindow, maxWords, words: totalWords, truncated } });
    try {
      const result = await retryTurn(provider, callMessages, {}, 10, {}, "background");
      const rawSummary = result.type === "text" ? (result.content ?? "(empty summary)") : "(compaction failed)";
      // Strip the <analysis> scratchpad block — only the <summary> block is stored.
      const summary = extractSummaryBlock(rawSummary);
      log("info", `compaction: done on attempt ${attempt}, summary length=${summary.length}`, { taskId });

      const msgId = appendMessage(
        taskId,
        task.conversation_id ?? 0,
        "compaction_summary",
        null,
        summary,
      );
      const msgRow = db
        .query<ConversationMessageRow, [number]>(
          "SELECT * FROM conversation_messages WHERE id = ?",
        )
        .get(msgId)!;
      return mapConversationMessage(msgRow);
    } catch (err) {
      lastErr = err;
      const msg = err instanceof Error ? err.message : String(err);
      // Detect actual context overflow: LM Studio returns "n_keep: X >= n_ctx: Y"
      if (/n_keep.*n_ctx|context length|context window/i.test(msg)) {
        // Parse the real n_ctx from the error if available, then use a conservative
        // 4 chars/token ratio (code is dense; 1.3 words/token was too optimistic).
        const nCtxMatch = msg.match(/n_ctx:\s*(\d+)/);
        const realCtx = nCtxMatch ? parseInt(nCtxMatch[1], 10) : Math.floor(maxWords / 2);
        const newMaxWords = Math.floor((realCtx - 500) / 4);
        log("warn", `compaction: context overflow on attempt ${attempt}, n_ctx=${realCtx ?? "unknown"}, new budget: ${newMaxWords} words`, { taskId });
        maxWords = newMaxWords;
        if (maxWords < 50) {
          log("error", "compaction: budget too small to continue", { taskId });
          break;
        }
        continue;
      }
      // Non-recoverable error
      log("error", `compaction: provider.turn failed: ${msg}`, { taskId });
      throw err;
    }
  }

  log("error", `compaction: all ${MAX_RETRIES} attempts failed`, { taskId });
  throw lastErr;
}

// ─── Task 5.1: Transition handler ─────────────────────────────────────────────

export async function handleTransition(
  taskId: number,
  toState: string,
  onToken: OnToken,
  onError: OnError,
  onTaskUpdated: OnTaskUpdated,
  onNewMessage: OnNewMessage,
): Promise<{ task: Task; executionId: number | null }> {
  const db = getDb();

  const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  // Ensure the task has a valid conversation — legacy tasks may have a null or stale conversation_id.
  const conversationId = ensureTaskConversation(taskId, task.conversation_id);

  const fromState = task.workflow_state;

  // 1. Update workflow_state immediately (design D6)
  db.run("UPDATE tasks SET workflow_state = ? WHERE id = ?", [toState, taskId]);

  // 2. Append transition event to conversation
  appendMessage(taskId, conversationId, "transition_event", null, "", {
    from: fromState,
    to: toState,
  });

  // 3. Get column config for the destination column
  const templateId = getBoardTemplateId(task.board_id);
  const column = getColumnConfig(templateId, toState);

  // Resolve and persist model — column model takes precedence, workspace default is fallback
  if (column?.model != null) {
    db.run("UPDATE tasks SET model = ? WHERE id = ?", [column.model, taskId]);
  } else {
    const workspaceDefault = getConfig()?.workspace.default_model;
    if (workspaceDefault != null) {
      db.run("UPDATE tasks SET model = ? WHERE id = ?", [workspaceDefault, taskId]);
    }
  }

  // 4. If no prompt configured → idle (design D7)
  if (!column?.on_enter_prompt) {
    db.run("UPDATE tasks SET execution_state = 'idle' WHERE id = ?", [taskId]);
    const updated = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
    return { task: mapTask(updated), executionId: null };
  }

  // 5. Create execution record
  const execResult = db.run(
    `INSERT INTO executions (task_id, from_state, to_state, prompt_id, status, attempt)
     VALUES (?, ?, ?, ?, 'running', 1)`,
    [taskId, fromState, toState, column.id],
  );
  const executionId = execResult.lastInsertRowid as number;

  // 6. Update task execution state to running + link execution
  db.run(
    "UPDATE tasks SET execution_state = 'running', current_execution_id = ? WHERE id = ?",
    [executionId, taskId],
  );

  // 7. Append system message
  appendMessage(
    taskId,
    conversationId,
    "system",
    null,
    `Running prompt: ${column.id}`,
  );

  // 8. Resolve and persist the on_enter_prompt so its content survives in
  // conversation history across subsequent human turns and compaction.
  // Resolution happens here so the worktree context is available.
  const transitionGitRow = db
    .query<{ worktree_path: string | null; worktree_status: string }, [number]>(
      "SELECT worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
    )
    .get(taskId);
  const transitionWorktreePath =
    transitionGitRow?.worktree_status === "ready" ? (transitionGitRow.worktree_path ?? "") : "";
  let resolvedOnEnterPrompt = column.on_enter_prompt;
  try {
    resolvedOnEnterPrompt = await resolveSlashReference(column.on_enter_prompt, transitionWorktreePath);
  } catch {
    // If resolution fails, fall back to raw slug — runExecution will surface the error
  }
  appendMessage(
    taskId,
    conversationId,
    "user",
    "prompt",
    column.on_enter_prompt,
    resolvedOnEnterPrompt === column.on_enter_prompt
      ? undefined
      : {
          resolved_content: resolvedOnEnterPrompt,
          display_content: column.on_enter_prompt,
        },
  );

  // 9. Register AbortController for cancellation (D3)
  const controller = new AbortController();
  executionControllers.set(executionId, controller);

  // 9. Run async (non-blocking)
  const updatedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
  const resolvedModel = updatedRow.model ?? "";
  runExecution(taskId, executionId, resolvedOnEnterPrompt, column.stage_instructions, resolvedModel, controller.signal, onToken, onError, onTaskUpdated, onNewMessage).catch(
    () => { },
  );

  return { task: mapTask(updatedRow), executionId };
}

// ─── Sub-agent helper ─────────────────────────────────────────────────────────

/**
 * Run an in-memory sub-execution for spawn_agent.
 * No DB records are created. Returns a plain text summary string.
 * Each child starts fresh — the parent's conversation history is NOT passed.
 */
async function runSubExecution({
  worktreePath,
  instructions,
  tools,
  qualifiedModel,
  signal,
  agentLabel,
  parentContext,
  parentToolDefs,
}: {
  worktreePath: string;
  instructions: string;
  tools: string[];
  qualifiedModel: string;
  signal: AbortSignal;
  agentLabel?: string;
  /** When provided, use the parent's assembled message context as the base conversation.
   *  The child's instructions are appended as a final user message. This enables
   *  cache-prefix sharing with the parent, yielding near-100% cache hit on the first call. */
  parentContext?: AIMessage[];
  /** When provided, use these tool definitions for the API call (matching parent's cache prefix).
   *  The child's resolved tool names are used only as an execution whitelist. */
  parentToolDefs?: import("../ai/types.ts").AIToolDefinition[];
}): Promise<string> {
  const config = getConfig();
  let provider;
  try {
    ({ provider } = resolveProvider(qualifiedModel, config.providers));
  } catch {
    return "(sub-agent skipped: no provider configured for this model)";
  }

  // Resolve fallback provider for 529 exhaustion
  let fallbackProvider: import("../ai/types.ts").AIProvider | null = null;
  {
    const slashIdx = qualifiedModel.indexOf("/");
    const providerId = slashIdx >= 0 ? qualifiedModel.slice(0, slashIdx) : "";
    const activeProviderConfig = config.providers.find((p) => p.id === providerId);
    if (activeProviderConfig?.fallback_model) {
      try {
        ({ provider: fallbackProvider } = resolveProvider(activeProviderConfig.fallback_model, config.providers));
      } catch {
        fallbackProvider = null;
      }
    }
  }

  const subLspManager = new LSPServerManager(
    config.workspace.lsp?.servers ?? [],
    worktreePath,
  );
  const toolCtx = { worktreePath, searchConfig: config.workspace.search, mtimeCache: new Map<string, number>(), lspManager: subLspManager };
  // Child's own tool names — used as execution whitelist
  const childToolDefs = resolveToolsForColumn(tools).sort((a, b) => a.name.localeCompare(b.name));
  const childToolNames = new Set(childToolDefs.map((t) => t.name));
  // API tool definitions: use parent's (for cache prefix sharing) if provided, else child's own
  const apiToolDefs = parentToolDefs ?? childToolDefs;

  const systemContent = [
    "You are a focused sub-agent in an orchestrator-workers pipeline. Complete the task described in the user message.",
    "",
    "## Environment",
    `- worktree_path: ${worktreePath}`,
  ].join("\n");

  // When a parent context is provided, inherit it and append instructions as the
  // final user message. This shares the parent's cache prefix so the first API call
  // achieves a cache hit instead of a cold write.
  // When no parent context is provided (workflow triggers, tests), use the minimal
  // [system, user] pair construction.
  // When a parent context is provided, append instructions as a new user turn.
  // The parent's messages always end with a user message (the triggering prompt),
  // so we merge instructions into that final user message instead of pushing a
  // separate one — Anthropic's API requires strictly alternating user/assistant turns.
  const liveMessages: AIMessage[] = (() => {
    if (!parentContext) {
      return [
        { role: "system", content: systemContent },
        { role: "user", content: instructions },
      ];
    }
    const base = [...parentContext];
    const last = base[base.length - 1];
    if (last?.role === "user") {
      // Merge sub-agent instructions into the existing final user message to avoid
      // consecutive user turns (would cause a 422 from the Anthropic API).
      base[base.length - 1] = {
        ...last,
        content: `${last.content as string}\n\n---\n\n${instructions}`,
      };
      return base;
    }
    // Context ends with a non-user message (unlikely with current caller): append normally.
    return [...base, { role: "user", content: instructions }];
  })();

  const MAX_SUB_ROUNDS = 10;
  let toolRounds = 0;

  while (toolRounds < MAX_SUB_ROUNDS) {
    const turn = await retryTurn(provider, liveMessages, { tools: apiToolDefs, effort: "low", signal, agentLabel, maxTokens: 16384 }, undefined, {}, "foreground", fallbackProvider);

    if (turn.type === "text") {
      subLspManager.shutdown();
      return (turn.content && turn.content.length > 0) ? turn.content : "(no response)";
    }

    toolRounds++;

    liveMessages.push({
      role: "assistant",
      content: "",
      tool_calls: turn.calls,
    });

    for (const call of turn.calls) {
      const fnName = call.function.name;
      // spawn_agent cannot recursively spawn (prevent infinite nesting)
      if (fnName === "spawn_agent") {
        liveMessages.push({
          role: "tool",
          content: "Error: spawn_agent cannot be called from within a sub-agent.",
          tool_call_id: call.id,
          name: fnName,
        });
        continue;
      }
      // Tool execution whitelist: only allow tools in the child's tool list
      if (parentToolDefs && !childToolNames.has(fnName)) {
        liveMessages.push({
          role: "tool",
          content: `Error: tool "${fnName}" is not available to this sub-agent. Available tools: ${[...childToolNames].join(", ")}.`,
          tool_call_id: call.id,
          name: fnName,
        });
        continue;
      }
      const result = await executeTool(fnName, call.function.arguments, toolCtx);
      const llmStr = typeof result === "object" && result !== null && "content" in result
        ? (result as WriteResult).content
        : result as string;
      const toolLimit = TOOL_RESULT_LIMITS.get(fnName) ?? TOOL_RESULT_MAX_CHARS;
      const stored = llmStr.length > toolLimit
        ? llmStr.slice(0, toolLimit) + "\n\n[truncated]"
        : llmStr;
      liveMessages.push({
        role: "tool",
        content: stored,
        tool_call_id: call.id,
        name: fnName,
      });
    }
  }

  // Hit round limit — synthesize a return string without an extra API call.
  // Collecting the last round's tool names gives the parent enough context.
  const lastActions: string[] = [];
  for (const msg of liveMessages) {
    if (msg.role === "assistant" && msg.tool_calls && msg.tool_calls.length > 0) {
      lastActions.length = 0; // keep only the last assistant turn's actions
      for (const call of msg.tool_calls) {
        lastActions.push(call.function.name);
      }
    }
  }
  const actionSummary = lastActions.length > 0 ? `last actions: ${lastActions.join(", ")}` : "no tool calls recorded";
  subLspManager.shutdown();
  return `(sub-agent reached tool limit after ${MAX_SUB_ROUNDS} rounds — ${actionSummary})`;
}

// ─── Task 5.2 + 5.3: Execute prompt ──────────────────────────────────────────

async function runExecution(
  taskId: number,
  executionId: number,
  prompt: string,
  stageInstructions: string | undefined,
  model: string,
  signal: AbortSignal,
  onToken: OnToken,
  onError: OnError,
  onTaskUpdated: OnTaskUpdated,
  onNewMessage: OnNewMessage = () => {},
): Promise<void> {
  const db = getDb();

  // Helper: handle cancellation — tidy up DB and notify frontend
  function handleCancelled(task: { conversation_id: number | null }): void {
    log("info", "Execution cancelled", { taskId, executionId });
    executionControllers.delete(executionId);
    db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
    db.run(
      "UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?",
      [executionId],
    );
    const cancelledRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (cancelledRow) onTaskUpdated(mapTask(cancelledRow));
  }

  let lspManager: LSPServerManager | undefined;
  try {
    const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;

    // Auto-cancel any stale 'running' executions for this task. These arise when
    // a previous execution was interrupted (user transition, API error, app restart)
    // without being finalized. Leaving them in 'running' causes compactMessages()
    // to find orphaned tool_calls every time and log repeated warnings.
    const staleCancelled = db.run(
      "UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE task_id = ? AND status = 'running' AND id != ?",
      [taskId, executionId],
    );
    if (staleCancelled.changes > 0) {
      log("info", `Auto-cancelled ${staleCancelled.changes} stale running execution(s)`, { taskId, executionId });
    }

    // Auto-clean orphaned tool_call rows: a tool_call with no immediately following
    // tool_result can never be completed. These accumulate from crashed/cancelled
    // executions and cause repeated warnings from compactMessages(). Delete them so
    // subsequent calls are clean.
    const orphans = db.query<{ id: number }, [number]>(
      `SELECT cm1.id FROM conversation_messages cm1
       WHERE cm1.task_id = ? AND cm1.type = 'tool_call'
         AND NOT EXISTS (
           SELECT 1 FROM conversation_messages cm2
           WHERE cm2.id = cm1.id + 1 AND cm2.type = 'tool_result'
         )`,
    ).all(taskId);
    if (orphans.length > 0) {
      const ids = orphans.map((o) => o.id);
      db.run(`DELETE FROM conversation_messages WHERE id IN (${ids.join(",")})`, []);
      log("info", `Auto-cleaned ${orphans.length} orphaned tool_call(s) (msg ids: ${ids.join(", ")})`, { taskId, executionId });
    }

    log("info", "Execution started", { taskId, executionId, data: { model, column: task.workflow_state } });
    const templateId = getBoardTemplateId(task.board_id);
    const column = getColumnConfig(templateId, task.workflow_state);
    const history = db
      .query<ConversationMessageRow, [number]>(
        "SELECT * FROM conversation_messages WHERE task_id = ? ORDER BY id ASC",
      )
      .all(taskId);

    // Task 6.5: Fetch git context when worktree is ready
    const gitRow = db
      .query<Pick<TaskGitContextRow, "git_root_path" | "worktree_path" | "worktree_status">, [number]>(
        "SELECT git_root_path, worktree_path, worktree_status FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);
    let gitContext: { git_root_path: string; worktree_path: string | null; worktree_status: string; project_path: string } | undefined;
    if (gitRow?.worktree_status === "ready") {
      const project = getProjectById(task.project_id);
      if (project) {
        gitContext = {
          git_root_path: gitRow.git_root_path,
          worktree_path: gitRow.worktree_path,
          worktree_status: gitRow.worktree_status,
          project_path: project.projectPath,
        };
      }
    }

    // Resolve slash references in prompt and stage_instructions using the worktree path.
    // Resolution happens here (at execution time) so the worktree context is available.
    const worktreePath = gitContext?.worktree_path ?? "";
    let resolvedPrompt: string;
    let resolvedStageInstructions: string | undefined;
    try {
      resolvedPrompt = await resolveSlashReference(prompt, worktreePath);
      resolvedStageInstructions = stageInstructions
        ? await resolveSlashReference(stageInstructions, worktreePath)
        : undefined;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log("warn", `Slash reference resolution failed: ${msg}`, { taskId, executionId });
      appendMessage(taskId, task.conversation_id ?? 0, "system", null, `Error: ${msg}`);
      db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
      db.run(
        "UPDATE executions SET status = 'waiting_user', finished_at = datetime('now') WHERE id = ?",
        [executionId],
      );
      executionControllers.delete(executionId);
      const waitRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
      if (waitRow) onTaskUpdated(mapTask(waitRow));
      return;
    }

    // Task 5.3: Assemble full execution payload as messages
    const sessionNotes = readSessionMemory(taskId);
    const messages = assembleMessages(task, resolvedStageInstructions, history, resolvedPrompt, gitContext, sessionNotes, taskId, column?.tools);

    // Log the full message payload for debugging (stored in DB only, not printed to stdout).
    log("debug", "Messages assembled for AI call", { taskId, executionId, data: { messageCount: messages.length, messages } });

    const config = getConfig();
    // Resolve provider from qualified model ID (e.g. "lmstudio/qwen3-8b")
    let provider;
    try {
      ({ provider } = resolveProvider(model, config.providers));
    } catch (err) {
      if (err instanceof UnresolvableProviderError) {
        const msg = err.message;
        log("warn", `Provider resolution failed: ${msg}`, { taskId, executionId });
        appendMessage(taskId, task.conversation_id ?? 0, "system", null, msg);
        db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
        db.run(
          "UPDATE executions SET status = 'waiting_user', finished_at = datetime('now') WHERE id = ?",
          [executionId],
        );
        executionControllers.delete(executionId);
        const awaitRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
        if (awaitRow) onTaskUpdated(mapTask(awaitRow));
        return;
      }
      throw err;
    }

    // Resolve fallback provider for 529 exhaustion (task 3.1)
    let fallbackProvider: import("../ai/types.ts").AIProvider | null = null;
    {
      const slashIdx = model.indexOf("/");
      const providerId = slashIdx >= 0 ? model.slice(0, slashIdx) : "";
      const activeProviderConfig = config.providers.find((p) => p.id === providerId);
      if (activeProviderConfig?.fallback_model) {
        try {
          ({ provider: fallbackProvider } = resolveProvider(activeProviderConfig.fallback_model, config.providers));
        } catch {
          fallbackProvider = null;
        }
      }
    }

    // ── Tool-call loop ────────────────────────────────────────────────────────
    const MAX_TOOL_ROUNDS = 10;
    // Build fire-and-forget wrappers so task tools can trigger transitions /
    // human turns without importing engine.ts (which would be circular).

    // Pre-fetch shell approval state for this execution
    const shellAutoApprove = task.shell_auto_approve === 1;
    const approvedCommandsSet: string[] = getApprovedCommands(taskId);

    const taskCallbacks: TaskToolCallbacks = {
      handleTransition: (tId, toState) => {
        handleTransition(tId, toState, onToken, onError, onTaskUpdated, onNewMessage).catch(
          (err) => log("error", `task-tool handleTransition failed: ${err}`, { taskId, executionId }),
        );
      },
      handleHumanTurn: (tId, message) => {
        handleHumanTurn(tId, message, onToken, onError, onTaskUpdated, onNewMessage).catch(
          (err) => log("error", `task-tool handleHumanTurn failed: ${err}`, { taskId, executionId }),
        );
      },
      cancelExecution: (execId) => cancelExecution(execId),
      requestShellApproval: (tId, command, unapprovedBinaries) => {
        return new Promise<ShellApprovalDecision>((resolve) => {
          // Write approval prompt to conversation
          const payload = JSON.stringify({ subtype: "shell_approval", command, unapprovedBinaries });
          const approvalMsgId = appendMessage(
            tId,
            task.conversation_id ?? 0,
            "ask_user_prompt" as MessageType,
            null,
            payload,
          );
          onNewMessage({
            id: approvalMsgId,
            taskId: tId,
            conversationId: task.conversation_id ?? 0,
            type: "ask_user_prompt" as MessageType,
            role: null,
            content: payload,
            metadata: null,
            createdAt: new Date().toISOString(),
          });
          onToken(tId, executionId, "", true);
          db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [tId]);
          db.run(
            "UPDATE executions SET status = 'waiting_user', finished_at = datetime('now') WHERE id = ?",
            [executionId],
          );
          const waitingRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(tId);
          if (waitingRow) onTaskUpdated(mapTask(waitingRow));
          pendingShellApprovals.set(tId, resolve);
        });
      },
      appendApprovedCommands: (tId, binaries) => {
        appendApprovedCommands(tId, binaries);
      },
    };
    lspManager = new LSPServerManager(
      config.workspace.lsp?.servers ?? [],
      worktreePath,
    );
    const toolCtx = {
      worktreePath,
      searchConfig: config.workspace.search,
      taskId,
      boardId: task.board_id,
      taskCallbacks,
      shellAutoApprove,
      approvedCommands: approvedCommandsSet,
      mtimeCache: new Map<string, number>(),
      lspManager,
    };

    let tools = resolveToolsForColumn(column?.tools);
    log("debug", `Tools resolved: ${tools.length} tools`, { taskId, executionId, data: { tools: tools.map(t => t.name), worktreePath: toolCtx.worktreePath } });
    const liveMessages: AIMessage[] = [...messages];

    // ── Unified streaming loop ────────────────────────────────────────────────
    // stream() always receives tool definitions. When the model responds with
    // text and no tool calls, that IS the final response (streamed live).
    // When the model responds with tool calls, they are executed and the loop
    // continues. No separate chat() call is needed.
    let fullResponse = "";
    let toolRounds = 0;
    let emptyResponseNudges = 0;
    let totalNudges = 0;
    let totalCostEst = 0;
    const MAX_NUDGES = 5;
    // Per-round reasoning accumulator — reset at start of each round
    let reasoningAccum = "";
    let hadReasoning = false;

    // Safely push a user nudge — if the last message is already a user turn,
    // append to it to avoid consecutive user messages (Qwen3 Jinja template error).
    function pushUserNudge(content: string) {
      const last = liveMessages[liveMessages.length - 1];
      if (last?.role === "user") {
        last.content = (last.content as string) + "\n\n" + content;
      } else {
        liveMessages.push({ role: "user", content });
      }
    }

    mainLoop: while (true) {
      // Check for cancellation between rounds
      if (signal.aborted) {
        handleCancelled(task);
        return;
      }

      let roundCalls: AIToolCall[] | null = null;
      // Reset per-round reasoning state
      reasoningAccum = "";
      hadReasoning = false;
      let stopReasonEvent: string | null = null;

      try {
        log("debug", `Stream round ${toolRounds + 1} started`, { taskId, executionId, data: { toolCount: tools.length, messageCount: liveMessages.length, messages: liveMessages } });
        const roundStartMs = Date.now();
        for await (const event of retryStream(provider, liveMessages, { tools, signal }, undefined, undefined, {}, "foreground", fallbackProvider)) {
          if (event.type === "token") {
            fullResponse += event.content;
            onToken(taskId, executionId, event.content, false);
          } else if (event.type === "reasoning") {
            reasoningAccum += event.content;
            hadReasoning = true;
            onToken(taskId, executionId, event.content, false, true);
          } else if (event.type === "status") {
            // Ephemeral status event from non-streaming fallback — forward to frontend only, no DB write.
            onToken(taskId, executionId, event.content, false, false, true);
          } else if (event.type === "tool_calls") {
            log("debug", `Tool calls received: ${event.calls.map(c => c.function.name).join(", ")}`, { taskId, executionId });
            roundCalls = event.calls;
          } else if (event.type === "stop_reason") {
            stopReasonEvent = event.reason;
          } else if (event.type === "usage") {
            totalCostEst += event.costEst;
            // Persist token usage to the executions row so estimateContextUsage()
            // can use actual counts instead of character-based estimates.
            db.run(
              "UPDATE executions SET input_tokens = ?, output_tokens = ?, cache_creation_input_tokens = ?, cache_read_input_tokens = ? WHERE id = ?",
              [event.usage.inputTokens, event.usage.outputTokens, event.usage.cacheCreationInputTokens ?? null, event.usage.cacheReadInputTokens ?? null, executionId],
            );
          } else if (event.type === "done") {
            break;
          }
        }
        log("debug", `Stream round ${toolRounds + 1} done in ${((Date.now() - roundStartMs) / 1_000).toFixed(1)}s`, { taskId, executionId });
      } catch (streamErr) {
        // Distinguish abort from real stream errors
        if (streamErr instanceof Error && streamErr.name === "AbortError") {
          if (fullResponse) {
            const { clean } = stripXmlToolCalls(fullResponse);
            if (clean && !isBadAssistantResponse(clean)) {
              const msgId = appendMessage(taskId, task.conversation_id ?? 0, "assistant", "assistant", clean);
              onNewMessage({ id: msgId, taskId, conversationId: task.conversation_id ?? 0, type: "assistant", role: "assistant", content: clean, metadata: null, createdAt: new Date().toISOString() });
            }
          }
          handleCancelled(task);
          return;
        }
        if (fullResponse) {
          const { clean } = stripXmlToolCalls(fullResponse);
          if (clean && !isBadAssistantResponse(clean)) {
            const msgId = appendMessage(taskId, task.conversation_id ?? 0, "assistant", "assistant", clean);
            onNewMessage({ id: msgId, taskId, conversationId: task.conversation_id ?? 0, type: "assistant", role: "assistant", content: clean, metadata: null, createdAt: new Date().toISOString() });
          }
        }
        const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
        log("error", `Stream error: ${errMsg}`, { taskId, executionId });
        appendMessage(taskId, task.conversation_id ?? 0, "system", null, `Stream error: ${errMsg}`);
        executionControllers.delete(executionId);
        db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [taskId]);
        db.run(
          "UPDATE executions SET status = 'failed', finished_at = datetime('now'), details = ? WHERE id = ?",
          [errMsg, executionId],
        );
        onError(taskId, executionId, errMsg);
        const failedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
        if (failedRow) onTaskUpdated(mapTask(failedRow));
        return;
      }

      // Handle non-standard stop reasons from the model
      if (stopReasonEvent) {
        if (stopReasonEvent === "refusal") {
          log("warn", `Model refused to respond (stop_reason: refusal)`, { taskId, executionId });
          const refusalMsg = "The model refused to generate a response for this request.";
          appendMessage(taskId, task.conversation_id ?? 0, "system", null, refusalMsg);
          executionControllers.delete(executionId);
          db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [taskId]);
          db.run(
            "UPDATE executions SET status = 'failed', finished_at = datetime('now'), details = ? WHERE id = ?",
            [refusalMsg, executionId],
          );
          onError(taskId, executionId, refusalMsg);
          const refusalRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
          if (refusalRow) onTaskUpdated(mapTask(refusalRow));
          return;
        } else if (stopReasonEvent === "model_context_window_exceeded") {
          log("warn", `Context window exceeded — triggering compaction`, { taskId, executionId });
          appendMessage(taskId, task.conversation_id ?? 0, "system", null, "Compacting conversation…");
          try {
            await compactConversation(taskId);
          } catch (compactErr) {
            const errMsg = compactErr instanceof Error ? compactErr.message : String(compactErr);
            log("error", `Compaction failed after context_window_exceeded: ${errMsg}`, { taskId, executionId });
          }
          // Reload messages and retry the round
          const freshRows = db.query<ConversationMessageRow, [number]>(
            "SELECT * FROM conversation_messages WHERE task_id = ? ORDER BY id ASC",
          ).all(taskId);
          const freshMessages = compactMessages(freshRows);
          liveMessages.length = 0;
          liveMessages.push(...freshMessages);
          fullResponse = "";
          continue;
        } else {
          log("warn", `Unrecognized stop_reason: ${stopReasonEvent} — continuing`, { taskId, executionId });
        }
      }

      // If no tool calls — the stream was the final response; exit
      if (!roundCalls) {
        // Qwen3 (and similar thinking models) sometimes emit <tool_call> XML blocks
        // inside their reasoning_content rather than delta.content. The result:
        // hadReasoning=true, fullResponse="", roundCalls=null. If we just break here
        // the task silently "completes" with no work done.
        // Detection: reasoning content contains a <tool_call> XML block.
        // Fix: persist the reasoning, nudge the model to re-emit using the API format.
        if (hadReasoning && !fullResponse) {
          hadReasoning = false;
          const reasoningHadXmlCalls = reasoningAccum.includes("<tool_call>");
          if (reasoningAccum) {
            const { clean: cleanReasoning } = stripXmlToolCalls(reasoningAccum);
            if (cleanReasoning) {
              const rId = appendMessage(taskId, task.conversation_id ?? 0, "reasoning" as MessageType, null, cleanReasoning);
              onNewMessage({ id: rId, taskId, conversationId: task.conversation_id ?? 0, type: "reasoning", role: null, content: cleanReasoning, metadata: null, createdAt: new Date().toISOString() });
            }
            reasoningAccum = "";
          }
          if (reasoningHadXmlCalls && emptyResponseNudges < 3 && totalNudges < MAX_NUDGES) {
            emptyResponseNudges++;
            totalNudges++;
            log("warn", `Model emitted tool calls inside reasoning_content — nudging for API format (nudge ${emptyResponseNudges})`, { taskId, executionId });
            pushUserNudge(
              "Please continue. Important: call tools using the API tool_call format, not inside your thinking. Output your next tool call or final response now.",
            );
            continue;
          }
          break mainLoop;
        }
        // Some models (e.g. Qwen3 thinking mode) emit reasoning internally
        // and produce an empty delta.content response. Nudge once — keep
        // tools enabled so the model can still call them if needed.
        if (!fullResponse && emptyResponseNudges < 3 && totalNudges < MAX_NUDGES) {
          emptyResponseNudges++;
          totalNudges++;
          log("warn", `Empty response from model, nudging for text output (nudge ${emptyResponseNudges})`, { taskId, executionId });
          pushUserNudge(
            "Please continue: either call the next tool you need using the API tool_call mechanism, or write your response directly if you have enough information.",
          );
          continue;
        }
        break mainLoop;
      }

      // ── Execute tool calls ────────────────────────────────────────────────
      toolRounds++;
      // Reset nudge counters — productive tool round means the empty-response
      // nudge budget is fully restored for the next round.
      emptyResponseNudges = 0;
      totalNudges = 0;

      // Persist reasoning accumulated before these tool calls (task 2.3)
      // Strip any embedded XML tool-call blocks from the thinking text before storing.
      if (reasoningAccum) {
        const { clean: cleanReasoning } = stripXmlToolCalls(reasoningAccum);
        if (cleanReasoning) {
          const rId = appendMessage(taskId, task.conversation_id ?? 0, "reasoning" as MessageType, null, cleanReasoning);
          onNewMessage({ id: rId, taskId, conversationId: task.conversation_id ?? 0, type: "reasoning", role: null, content: cleanReasoning, metadata: null, createdAt: new Date().toISOString() });
        }
        reasoningAccum = "";
        hadReasoning = false;
      }

      // Preserve any preamble text the model emitted before its tool calls
      // (usually just whitespace, but send it faithfully so the model recognises
      // its own prior turn correctly). Reset for the next round.
      const preamble = fullResponse || null;
      fullResponse = "";

      // If the model emitted meaningful text before the tool calls, save it to
      // DB immediately (in order) so the conversation timeline shows text →
      // tools rather than tools → text.
      if (preamble && !isBadAssistantResponse(preamble)) {
        const { clean: preambleClean } = stripXmlToolCalls(preamble);
        if (preambleClean && !isBadAssistantResponse(preambleClean)) {
          const preambleId = appendMessage(
            taskId,
            task.conversation_id ?? 0,
            "assistant",
            "assistant",
            preambleClean,
          );
          onNewMessage({
            id: preambleId,
            taskId,
            conversationId: task.conversation_id ?? 0,
            type: "assistant",
            role: "assistant",
            content: preambleClean,
            metadata: null,
            createdAt: new Date().toISOString(),
          });
        }
      }

      // Sanitize tool call arguments — ensure each call has valid JSON args
      // (empty string → "{}") to prevent OpenAI-compat servers from returning 500.
      const sanitizedRoundCalls = roundCalls.map((c) => ({
        ...c,
        function: {
          ...c.function,
          arguments: c.function.arguments && c.function.arguments.trim() !== ""
            ? c.function.arguments
            : "{}",
        },
      }));

      liveMessages.push({
        role: "assistant",
        content: preamble,
        tool_calls: sanitizedRoundCalls,
      });

      // Intercept ask_me before executing any tools — it suspends execution
      const askUserCall = sanitizedRoundCalls.find((c) => c.function.name === "ask_me");
      if (askUserCall) {
        // Parse and normalize: accept both the new { questions: [...] } format
        // and the legacy { question, selection_mode, options: string[] } format.
        let normalized: { questions: Array<{ question: string; selection_mode: string; options: Array<{ label: string; description?: string; recommended?: boolean; preview?: string }> }> };
        try {
          const raw = JSON.parse(askUserCall.function.arguments);
          if (Array.isArray(raw.questions)) {
            // New format — normalize option objects (handle partial objects)
            normalized = {
              questions: raw.questions.map((q: Record<string, unknown>) => ({
                question: q.question ?? "",
                selection_mode: q.selection_mode ?? "single",
                options: Array.isArray(q.options)
                  ? q.options.map((o: unknown) =>
                    typeof o === "string"
                      ? { label: o }
                      : { label: (o as Record<string, unknown>).label ?? String(o), ...(o as Record<string, unknown>) },
                  )
                  : [],
              })),
            };
          } else {
            // Legacy flat format: { question, selection_mode, options: string[] }
            const legacyOptions: string[] = Array.isArray(raw.options) ? raw.options : [];
            normalized = {
              questions: [{
                question: raw.question ?? "",
                selection_mode: raw.selection_mode ?? "single",
                options: legacyOptions.map((o: unknown) =>
                  typeof o === "string" ? { label: o } : { label: String(o) },
                ),
              }],
            };
          }
        } catch {
          normalized = { questions: [{ question: askUserCall.function.arguments, selection_mode: "single", options: [] }] };
        }
        // Qwen3 sometimes calls ask_me with empty arguments {} — the actual question
        // was only in its reasoning_content. Nudge it to re-call with proper args.
        const firstQ = normalized.questions[0];
        if (!normalized.questions.length || !firstQ?.question?.trim() || !firstQ?.options?.length) {
          if (emptyResponseNudges < 3 && totalNudges < MAX_NUDGES) {
            emptyResponseNudges++;
            totalNudges++;
            log("warn", `ask_me called with missing question or options — nudging for proper arguments (nudge ${emptyResponseNudges})`, { taskId, executionId });
            liveMessages.push({
              role: "tool",
              content: "Error: ask_me was called with missing or empty fields. You MUST call ask_me again with a non-empty 'questions' array. Each question needs 'question' (text), 'selection_mode' ('single' or 'multi'), and 'options' (non-empty array of objects with at least a 'label' field).",
              tool_call_id: askUserCall.id,
            });
            continue;
          }
          // Budget exhausted — fall through to normal tool execution which will skip ask_me
          log("warn", "ask_me called without question/options repeatedly — skipping", { taskId, executionId });
        } else {
          const askMsgId = appendMessage(
            taskId,
            task.conversation_id ?? 0,
            "ask_user_prompt" as MessageType,
            null,
            JSON.stringify(normalized),
          );
          // Push the ask_user_prompt to the frontend immediately and fire the
          // streaming-done signal so the streaming bubble is cleared.
          onNewMessage({
            id: askMsgId,
            taskId,
            conversationId: task.conversation_id ?? 0,
            type: "ask_user_prompt" as MessageType,
            role: null,
            content: JSON.stringify(normalized),
            metadata: null,
            createdAt: new Date().toISOString(),
          });
          onToken(taskId, executionId, "", true);
          executionControllers.delete(executionId);
          db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
          db.run(
            "UPDATE executions SET status = 'waiting_user', finished_at = datetime('now') WHERE id = ?",
            [executionId],
          );
          const waitingRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
          if (waitingRow) onTaskUpdated(mapTask(waitingRow));
          return;
        }
      }

      // Intercept interview_me before executing any tools — suspends execution
      const interviewCall = sanitizedRoundCalls.find((c) => c.function.name === "interview_me");
      if (interviewCall) {
        let normalized: { context?: string; questions: Array<{ question: string; type: string; weight?: string; model_lean?: string; model_lean_reason?: string; answers_affect_followup?: boolean; options?: Array<{ title: string; description: string }> }> };
        try {
          const raw = JSON.parse(interviewCall.function.arguments) as Record<string, unknown>;
          normalized = {
            ...(raw.context ? { context: String(raw.context) } : {}),
            questions: (Array.isArray(raw.questions) ? raw.questions : []).map((q: Record<string, unknown>) => ({
              question: String(q.question ?? ""),
              type: (["exclusive", "non_exclusive", "freetext"].includes(String(q.type)) ? q.type : "exclusive") as string,
              ...(q.weight ? { weight: q.weight } : {}),
              ...(q.model_lean ? { model_lean: String(q.model_lean) } : {}),
              ...(q.model_lean_reason ? { model_lean_reason: String(q.model_lean_reason) } : {}),
              ...(q.answers_affect_followup ? { answers_affect_followup: true } : {}),
              ...(Array.isArray(q.options) ? {
                options: q.options.map((o: unknown) => ({
                  title: String((o as Record<string, unknown>).title ?? ""),
                  description: String((o as Record<string, unknown>).description ?? ""),
                })),
              } : {}),
            })),
          };
        } catch {
          normalized = { questions: [] };
        }

        // Validate: must have at least one question with content
        const firstQ = normalized.questions[0];
        const isValid = normalized.questions.length > 0 &&
          firstQ?.question?.trim() &&
          (firstQ.type === "freetext" || (Array.isArray(firstQ.options) && firstQ.options.length > 0));

        if (!isValid) {
          if (emptyResponseNudges < 3 && totalNudges < MAX_NUDGES) {
            emptyResponseNudges++;
            totalNudges++;
            log("warn", `interview_me called with missing/empty fields — nudging (nudge ${emptyResponseNudges})`, { taskId, executionId });
            liveMessages.push({
              role: "tool",
              content: "Error: interview_me was called with missing or empty fields. You MUST call interview_me again with a non-empty 'questions' array. Each question needs 'question' (text) and 'type' ('exclusive'/'non_exclusive'/'freetext'). Questions of type 'exclusive' or 'non_exclusive' need a non-empty 'options' array where each option has 'title' and 'description'.",
              tool_call_id: interviewCall.id,
            });
            continue;
          }
          log("warn", "interview_me called without valid questions repeatedly — skipping", { taskId, executionId });
        } else {
          const interviewMsgId = appendMessage(
            taskId,
            task.conversation_id ?? 0,
            "interview_prompt" as MessageType,
            null,
            JSON.stringify(normalized),
          );
          onNewMessage({
            id: interviewMsgId,
            taskId,
            conversationId: task.conversation_id ?? 0,
            type: "interview_prompt" as MessageType,
            role: null,
            content: JSON.stringify(normalized),
            metadata: null,
            createdAt: new Date().toISOString(),
          });
          onToken(taskId, executionId, "", true);
          executionControllers.delete(executionId);
          db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
          db.run(
            "UPDATE executions SET status = 'waiting_user', finished_at = datetime('now') WHERE id = ?",
            [executionId],
          );
          const waitingRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
          if (waitingRow) onTaskUpdated(mapTask(waitingRow));
          return;
        }
      }

      // Intercept spawn_agent
      const spawnCall = sanitizedRoundCalls.find((c) => c.function.name === "spawn_agent");
      if (spawnCall) {
        let spawnArgs: { children: Array<{ instructions: string; tools: string[]; scope?: string }> };
        try {
          spawnArgs = JSON.parse(spawnCall.function.arguments);
        } catch {
          spawnArgs = { children: [] };
        }

        // Record tool_call message before executing children, matching the pattern
        // used by all other tools in the loop.
        const spawnCallContent = JSON.stringify({ name: "spawn_agent", arguments: spawnCall.function.arguments });
        const spawnCallId = appendMessage(
          taskId,
          task.conversation_id ?? 0,
          "tool_call",
          null,
          spawnCallContent,
        );
        onNewMessage({
          id: spawnCallId, taskId, conversationId: task.conversation_id ?? 0,
          type: "tool_call", role: null, content: spawnCallContent, metadata: null,
          createdAt: new Date().toISOString(),
        });

        const childResults = await Promise.all(
          (spawnArgs.children ?? []).map(async (child, idx) => {
            try {
              const totalChildren = (spawnArgs.children ?? []).length;
              const result = await runSubExecution({
                worktreePath: toolCtx.worktreePath,
                instructions: child.instructions,
                tools: child.tools,
                qualifiedModel: model,
                signal,
                agentLabel: `Agent ${idx + 1}/${totalChildren}`,
                // Pass the assembled parent context so the sub-agent starts from the
                // same cache prefix. The `messages` variable is the context assembled
                // for this round (already micro-compacted via compactMessages).
                parentContext: messages,
                // Pass the parent's full sorted tool definitions so the sub-agent
                // uses the same [system, tools] prefix → cache hit on first call.
                parentToolDefs: tools,
              });
              return `[Agent ${idx + 1}${child.scope ? ` (${child.scope})` : ""}]: ${result}`;
            } catch (e) {
              return `[Agent ${idx + 1}${child.scope ? ` (${child.scope})` : ""}]: Error — ${e instanceof Error ? e.message : String(e)}`;
            }
          }),
        );

        const spawnResultStr = JSON.stringify(childResults);
        const spawnLimit = TOOL_RESULT_LIMITS.get("spawn_agent") ?? TOOL_RESULT_MAX_CHARS;
        const stored = spawnResultStr.length > spawnLimit
          ? spawnResultStr.slice(0, spawnLimit) + "\n\n[truncated]"
          : spawnResultStr;

        appendMessage(
          taskId,
          task.conversation_id ?? 0,
          "tool_result",
          null,
          stored,
          { tool_call_id: spawnCall.id, name: "spawn_agent" },
        );

        liveMessages.push({
          role: "tool",
          content: stored,
          tool_call_id: spawnCall.id,
          name: "spawn_agent",
        });
        continue;
      }

      for (const call of sanitizedRoundCalls) {
        const fnName = call.function.name;
        const fnArgs = call.function.arguments;
        log("debug", `Tool call: ${fnName}`, { taskId, executionId, data: { args: fnArgs } });

        const callContent = JSON.stringify({ name: fnName, arguments: fnArgs });
        const callId = appendMessage(
          taskId,
          task.conversation_id ?? 0,
          "tool_call",
          null,
          callContent,
        );
        onNewMessage({
          id: callId, taskId, conversationId: task.conversation_id ?? 0,
          type: "tool_call", role: null, content: callContent, metadata: null,
          createdAt: new Date().toISOString(),
        });

        const result = await executeTool(fnName, fnArgs, toolCtx);

        // Self-delete guard: if this task itself was just deleted, stop the loop
        // gracefully rather than continuing to act on behalf of a non-existent task.
        if (fnName === "delete_task") {
          const stillExists = db
            .query<{ id: number }, [number]>("SELECT id FROM tasks WHERE id = ?")
            .get(taskId);
          if (!stillExists) {
            // Task is gone — clean up and exit without changing any DB row
            executionControllers.delete(executionId);
            return;
          }
        }

        // Write tools return { content, diff } or { content, diffs }; read/search tools return a plain string
        const isWriteResult = typeof result === "object" && result !== null && "content" in result;
        const llmContent = isWriteResult ? (result as WriteResult).content : result as string;
        const diff = isWriteResult ? (result as WriteResult).diff : undefined;
        const diffs = isWriteResult ? (result as WriteResult).diffs : undefined;

        const toolLimit = TOOL_RESULT_LIMITS.get(fnName) ?? TOOL_RESULT_MAX_CHARS;
        const storedResult = llmContent.length > toolLimit
          ? llmContent.slice(0, toolLimit) + "\n\n[truncated]"
          : llmContent;

        const resultMeta = { tool_call_id: call.id, name: fnName };
        const resultId = appendMessage(
          taskId,
          task.conversation_id ?? 0,
          "tool_result",
          null,
          storedResult,
          resultMeta,
        );
        onNewMessage({
          id: resultId, taskId, conversationId: task.conversation_id ?? 0,
          type: "tool_result", role: null, content: storedResult, metadata: resultMeta,
          createdAt: new Date().toISOString(),
        });

        // Emit UI-only file_diff message (never forwarded to LLM)
        const diffsToEmit = diffs ?? (diff ? [diff] : []);
        for (const d of diffsToEmit) {
          const diffContent = JSON.stringify(d);
          const diffId = appendMessage(
            taskId,
            task.conversation_id ?? 0,
            "file_diff",
            null,
            diffContent,
          );
          onNewMessage({
            id: diffId, taskId, conversationId: task.conversation_id ?? 0,
            type: "file_diff", role: null, content: diffContent, metadata: null,
            createdAt: new Date().toISOString(),
          });
        }

        liveMessages.push({
          role: "tool",
          content: storedResult,
          tool_call_id: call.id,
          name: fnName,
        });
      }

      if (toolRounds >= MAX_TOOL_ROUNDS) {
        liveMessages.push({
          role: "user",
          content: "You have reached the tool call limit. Please summarise your findings and respond now. Do not call any more tools.",
        });
        // Keep tools in the request to preserve the cache prefix (tools → system → messages).
        // Dropping tools changes the tools hash and invalidates the entire cache, causing an
        // expensive cold write on content that is never read again. The "do not call any more
        // tools" instruction is sufficient to prevent further tool use.
      }
    }

    // If signal aborted mid-stream
    if (signal.aborted) {
      if (fullResponse) {
        const { clean } = stripXmlToolCalls(fullResponse);
        if (clean && !isBadAssistantResponse(clean)) {
          const msgId = appendMessage(taskId, task.conversation_id ?? 0, "assistant", "assistant", clean);
          onNewMessage({ id: msgId, taskId, conversationId: task.conversation_id ?? 0, type: "assistant", role: "assistant", content: clean, metadata: null, createdAt: new Date().toISOString() });
        }
      }
      handleCancelled(task);
      return;
    }

    // Strip any XML tool-call blocks the model emitted as raw text
    log("debug", "Model response received", { taskId, executionId, data: { response: fullResponse } });
    const { clean: cleanResponse, hadToolCalls: hadXmlToolCalls } = stripXmlToolCalls(fullResponse);

    if (hadXmlToolCalls) {
      log("warn", "Model used XML tool call format — stripping and correcting", { taskId, executionId });
    }

    // Persist any reasoning that preceded the final response (task 2.3)
    // Strip any embedded XML tool-call blocks from the thinking text before storing.
    if (reasoningAccum) {
      const { clean: cleanReasoning } = stripXmlToolCalls(reasoningAccum);
      if (cleanReasoning) {
        const rId = appendMessage(taskId, task.conversation_id ?? 0, "reasoning" as MessageType, null, cleanReasoning);
        onNewMessage({ id: rId, taskId, conversationId: task.conversation_id ?? 0, type: "reasoning", role: null, content: cleanReasoning, metadata: null, createdAt: new Date().toISOString() });
      }
      reasoningAccum = "";
    }

    if (!isBadAssistantResponse(cleanResponse)) {
      const msgId = appendMessage(taskId, task.conversation_id ?? 0, "assistant", "assistant", cleanResponse);
      onNewMessage({ id: msgId, taskId, conversationId: task.conversation_id ?? 0, type: "assistant", role: "assistant", content: cleanResponse, metadata: null, createdAt: new Date().toISOString() });

      // Trigger background session memory extraction every N completed AI turns.
      // Count only persisted assistant messages so the interval is stable.
      const assistantCount = db
        .query<{ count: number }, [number]>(
          "SELECT COUNT(*) as count FROM conversation_messages WHERE task_id = ? AND role = 'assistant'",
        )
        .get(taskId)?.count ?? 0;
      if (assistantCount > 0 && assistantCount % SESSION_MEMORY_EXTRACTION_INTERVAL === 0) {
        extractSessionMemory(taskId);
      }
    }

    // If the model emitted XML tool calls, append a corrective system message so
    // it knows they were not executed and learns to use the API mechanism next time.
    if (hadXmlToolCalls) {
      appendMessage(
        taskId,
        task.conversation_id ?? 0,
        "system",
        null,
        "Your tool calls were written as XML (`<tool_call>`) and were NOT executed. " +
        "You MUST invoke tools using the API tool_call mechanism only — never write tool calls as XML, JSON, or any text format in your response.",
      );
    }

    // If the model produced nothing at all (no tool calls, no text) after all nudges,
    // treat it as a failure — don't silently mark as completed with no visible output.
    if (toolRounds === 0 && isBadAssistantResponse(cleanResponse)) {
      const emptyErrMsg = "Model produced no output after multiple attempts. This may indicate the conversation context is too large for the model's context window. Try switching to a model with a larger context window, or start a new task.";
      log("warn", "Execution produced no output — failing", { taskId, executionId });
      appendMessage(taskId, task.conversation_id ?? 0, "system", null, emptyErrMsg);
      executionControllers.delete(executionId);
      db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [taskId]);
      db.run(
        "UPDATE executions SET status = 'failed', finished_at = datetime('now'), details = ? WHERE id = ?",
        [emptyErrMsg, executionId],
      );
      onError(taskId, executionId, emptyErrMsg);
      const emptyFailedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
      if (emptyFailedRow) onTaskUpdated(mapTask(emptyFailedRow));
      return;
    }

    log("info", `Execution completed (${toolRounds} round${toolRounds !== 1 ? "s" : ""}, ~$${totalCostEst.toFixed(4)})`, { taskId, executionId });
    onToken(taskId, executionId, "", true);
    db.run("UPDATE tasks SET execution_state = 'completed' WHERE id = ?", [taskId]);
    db.run(
      "UPDATE executions SET status = 'completed', finished_at = datetime('now'), summary = ?, cost_estimate = ? WHERE id = ?",
      [cleanResponse.slice(0, 500), totalCostEst, executionId],
    );
    const completedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (completedRow) onTaskUpdated(mapTask(completedRow));

    // Flush one pending message queued while this task was running.
    // Only one message is flushed per execution to avoid rapid-fire re-triggering.
    const pendingMsg = db
      .query<{ id: number; content: string }, [number]>(
        "SELECT id, content FROM pending_messages WHERE task_id = ? ORDER BY id ASC LIMIT 1",
      )
      .get(taskId);
    if (pendingMsg) {
      db.run("DELETE FROM pending_messages WHERE id = ?", [pendingMsg.id]);
      handleHumanTurn(taskId, pendingMsg.content, onToken, onError, onTaskUpdated, onNewMessage).catch(
        (err) => log("error", `pending_message flush failed: ${err}`, { taskId, executionId }),
      );
    }
  } catch (err) {
    // Top-level abort catch
    if (err instanceof Error && err.name === "AbortError") {
      const task = db.query<{ conversation_id: number | null }, [number]>(
        "SELECT conversation_id FROM tasks WHERE id = ?",
      ).get(taskId);
      handleCancelled(task ?? { conversation_id: null });
      return;
    }
    const errMsg = err instanceof Error ? err.message : String(err);
    log("error", `Execution failed: ${errMsg}`, { taskId, executionId });
    const task = db.query<{ conversation_id: number }, [number]>(
      "SELECT conversation_id FROM tasks WHERE id = ?",
    ).get(taskId);
    if (task) {
      appendMessage(taskId, task.conversation_id, "system", null, `Execution error: ${errMsg}`);
    }
    executionControllers.delete(executionId);
    db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [taskId]);
    db.run(
      "UPDATE executions SET status = 'failed', finished_at = datetime('now'), details = ? WHERE id = ?",
      [errMsg, executionId],
    );
    onError(taskId, executionId, errMsg);
    const outerFailedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (outerFailedRow) onTaskUpdated(mapTask(outerFailedRow));
  } finally {
    lspManager?.shutdown();
  }
}
// ─── Task 5.7: Human turn ─────────────────────────────────────────────────────

export async function handleHumanTurn(
  taskId: number,
  content: string,
  onToken: OnToken,
  onError: OnError,
  onTaskUpdated: OnTaskUpdated,
  onNewMessage: OnNewMessage,
): Promise<{ message: ConversationMessage; executionId: number }> {
  const db = getDb();
  const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);
  const conversationId = ensureTaskConversation(taskId, task.conversation_id);

  // Append user message
  const msgId = appendMessage(
    taskId,
    conversationId,
    "user",
    "user",
    content,
  );

  // Auto-compact if context usage is at or above 90%
  const config = getConfig();
  const qualifiedModel2 = task.model ?? "";
  const provId2 = qualifiedModel2.split("/")[0];
  const provConf2 = config.providers.find((p) => p.id === provId2);
  const contextWindowTokens = provConf2?.context_window_tokens ?? 128_000;
  const { fraction } = estimateContextUsage(taskId, contextWindowTokens);
  if (fraction >= 0.90) {
    appendMessage(taskId, conversationId, "system", null, "Compacting conversation…");
    try {
      await compactConversation(taskId);
    } catch {
      // compaction failure should not block the send
    }
  }

  // Get stage instructions for current column
  const templateId = getBoardTemplateId(task.board_id);
  const column = getColumnConfig(templateId, task.workflow_state);

  // Create execution record for this human turn
  const execResult = db.run(
    `INSERT INTO executions (task_id, from_state, to_state, prompt_id, status, attempt)
     VALUES (?, ?, ?, 'human-turn', 'running', ?)`,
    [taskId, task.workflow_state, task.workflow_state, task.retry_count + 1],
  );
  const executionId = execResult.lastInsertRowid as number;

  db.run(
    "UPDATE tasks SET execution_state = 'running', current_execution_id = ? WHERE id = ?",
    [executionId, taskId],
  );

  // Notify frontend immediately so the card flips to "running"
  const runningRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
  onTaskUpdated(mapTask(runningRow));

  const msgRow = db
    .query<ConversationMessageRow, [number]>(
      "SELECT * FROM conversation_messages WHERE id = ?",
    )
    .get(msgId)!;

  // Register AbortController for cancellation (D3)
  const controller = new AbortController();
  executionControllers.set(executionId, controller);

  // Resolve model: use the task's persisted model (D1)
  const resolvedModel = task.model ?? "";

  // Run async
  runExecution(taskId, executionId, content, column?.stage_instructions, resolvedModel, controller.signal, onToken, onError, onTaskUpdated, onNewMessage).catch(
    () => { },
  );

  return { message: mapConversationMessage(msgRow), executionId };
}

// ─── Task 5.9: Retry ──────────────────────────────────────────────────────────

export async function handleRetry(
  taskId: number,
  onToken: OnToken,
  onError: OnError,
  onTaskUpdated: OnTaskUpdated,
  onNewMessage: OnNewMessage,
): Promise<{ task: Task; executionId: number }> {
  const db = getDb();
  const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const templateId = getBoardTemplateId(task.board_id);
  const column = getColumnConfig(templateId, task.workflow_state);

  // Increment retry count
  db.run("UPDATE tasks SET retry_count = retry_count + 1 WHERE id = ?", [taskId]);

  // Create new execution
  const attempt = (task.retry_count ?? 0) + 1;
  const execResult = db.run(
    `INSERT INTO executions (task_id, from_state, to_state, prompt_id, status, attempt)
     VALUES (?, ?, ?, ?, 'running', ?)`,
    [taskId, task.workflow_state, task.workflow_state, column?.id ?? "retry", attempt],
  );
  const executionId = execResult.lastInsertRowid as number;

  db.run(
    "UPDATE tasks SET execution_state = 'running', current_execution_id = ? WHERE id = ?",
    [executionId, taskId],
  );

  appendMessage(
    taskId,
    task.conversation_id ?? 0,
    "system",
    null,
    `Retry attempt ${attempt}`,
  );

  const updatedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;

  // Register AbortController for cancellation
  const controller = new AbortController();
  executionControllers.set(executionId, controller);

  // Resolve model: use the task's persisted model
  const resolvedModel = updatedRow.model ?? "";

  runExecution(
    taskId,
    executionId,
    column?.on_enter_prompt ?? "Please continue with the task.",
    column?.stage_instructions,
    resolvedModel,
    controller.signal,
    onToken,
    onError,
    onTaskUpdated,
    onNewMessage,
  ).catch(() => { });

  return { task: mapTask(updatedRow), executionId };
}

// ─── Code review turn ─────────────────────────────────────────────────────────

export async function handleCodeReview(
  taskId: number,
  onToken: OnToken,
  onError: OnError,
  onTaskUpdated: OnTaskUpdated,
  onNewMessage: OnNewMessage,
): Promise<{ message: import("../../shared/rpc-types.ts").ConversationMessage; executionId: number }> {
  const db = getDb();
  const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  // Get the worktree path for this task (needed to run git diff and read files)
  const gitRow = db
    .query<{ worktree_path: string | null }, [number]>(
      "SELECT worktree_path FROM task_git_context WHERE task_id = ?",
    )
    .get(taskId);
  const worktreePath = gitRow?.worktree_path ?? "";

  // Build CodeReviewPayload from unsent DB decisions (human reviewer only)
  type DecisionRow = {
    hunk_hash: string;
    file_path: string;
    decision: string;
    comment: string | null;
    original_start: number;
    original_end: number;
    modified_start: number;
    modified_end: number;
  };
  const decisionRows = db
    .query<DecisionRow, [number]>(
      `SELECT hunk_hash, file_path, decision, comment, original_start, original_end, modified_start, modified_end
       FROM task_hunk_decisions
       WHERE task_id = ? AND reviewer_id = 'user' AND sent = 0
       ORDER BY file_path, modified_start`,
    )
    .all(taskId);

  // Build per-file diff cache to extract originalLines/modifiedLines by hash
  type HunkLines = { originalLines: string[]; modifiedLines: string[] };
  const diffCache = new Map<string, Map<string, HunkLines>>(); // file_path → hash → lines
  const uniqueFiles = [...new Set(decisionRows.map((r) => r.file_path))];
  for (const filePath of uniqueFiles) {
    const hunkLineMap = new Map<string, HunkLines>();
    if (worktreePath) {
      try {
        const proc = Bun.spawn(["git", "diff", "HEAD", "--", filePath], {
          cwd: worktreePath,
          stdout: "pipe",
          stderr: "pipe",
        });
        await proc.exited;
        const diffOut = await new Response(proc.stdout).text();
        if (diffOut.trim()) {
          const hhRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
          const lines = diffOut.split("\n");
          let i = 0;
          while (i < lines.length) {
            if (!hhRe.test(lines[i])) { i++; continue; }
            i++;
            const body: string[] = [];
            while (i < lines.length && !hhRe.test(lines[i])) { body.push(lines[i]); i++; }
            const origL = body.filter((l) => l.startsWith("-") || l.startsWith(" ")).map((l) => l.slice(1));
            const modL = body.filter((l) => l.startsWith("+") || l.startsWith(" ")).map((l) => l.slice(1));
            // Recompute hash to match the stored one (same algorithm as backend parser)
            const { createHash } = await import("node:crypto");
            const hash = createHash("sha256")
              .update(filePath + "\0" + origL.join("\n") + "\0" + modL.join("\n"))
              .digest("hex");
            hunkLineMap.set(hash, { originalLines: origL, modifiedLines: modL });
          }
        }
      } catch { /* ignore diff parse errors */ }
    }
    diffCache.set(filePath, hunkLineMap);
  }

  // Read unsent line comments grouped by file
  type LineCommentRow = {
    id: number;
    file_path: string;
    line_start: number;
    line_end: number;
    line_text: string;
    context_lines: string;
    comment: string;
    reviewer_type: string;
  };
  const lineCommentRows = db
    .query<LineCommentRow, [number]>(
      `SELECT id, file_path, line_start, line_end, line_text, context_lines, comment, reviewer_type
       FROM task_line_comments
       WHERE task_id = ? AND sent = 0
       ORDER BY file_path, line_start`,
    )
    .all(taskId);

  // Group decisions and line comments by file and build CodeReviewPayload
  const fileMap = new Map<string, { hunks: import("../../shared/rpc-types.ts").CodeReviewHunk[]; lineComments: import("../../shared/rpc-types.ts").LineComment[] }>();
  for (const row of decisionRows) {
    if (!fileMap.has(row.file_path)) fileMap.set(row.file_path, { hunks: [], lineComments: [] });
    const hunkLines = diffCache.get(row.file_path)?.get(row.hunk_hash) ?? { originalLines: [], modifiedLines: [] };
    fileMap.get(row.file_path)!.hunks.push({
      hunkIndex: 0,
      originalRange: [row.original_start, row.original_end],
      modifiedRange: [row.modified_start, row.modified_end],
      decision: row.decision as import("../../shared/rpc-types.ts").HunkDecision,
      comment: row.comment,
      originalLines: hunkLines.originalLines,
      modifiedLines: hunkLines.modifiedLines,
    });
  }
  for (const row of lineCommentRows) {
    if (!fileMap.has(row.file_path)) fileMap.set(row.file_path, { hunks: [], lineComments: [] });
    fileMap.get(row.file_path)!.lineComments.push({
      id: row.id,
      filePath: row.file_path,
      lineStart: row.line_start,
      lineEnd: row.line_end,
      lineText: JSON.parse(row.line_text),
      contextLines: JSON.parse(row.context_lines),
      comment: row.comment,
      reviewerType: row.reviewer_type as "human" | "ai",
    });
  }

  const payload: import("../../shared/rpc-types.ts").CodeReviewPayload = {
    taskId,
    files: Array.from(fileMap.entries()).map(([path, data]) => ({ path, hunks: data.hunks, lineComments: data.lineComments })),
  };

  const llmText = formatReviewMessageForLLM(payload);

  // Mark all included decisions and line comments as sent
  db.run(
    `UPDATE task_hunk_decisions SET sent = 1 WHERE task_id = ? AND reviewer_id = 'user' AND sent = 0`,
    [taskId],
  );
  db.run(
    `UPDATE task_line_comments SET sent = 1 WHERE task_id = ? AND sent = 0`,
    [taskId],
  );

  // Store the structured code_review message (UI-only, excluded from LLM)
  const reviewMsgId = appendMessage(
    taskId,
    task.conversation_id ?? 0,
    "code_review",
    "user",
    JSON.stringify(payload),
  );

  // Store the plain-text user message that the LLM will actually see
  appendMessage(
    taskId,
    task.conversation_id ?? 0,
    "user",
    "user",
    llmText,
  );

  const templateId = getBoardTemplateId(task.board_id);
  const column = getColumnConfig(templateId, task.workflow_state);

  const execResult = db.run(
    `INSERT INTO executions (task_id, from_state, to_state, prompt_id, status, attempt)
     VALUES (?, ?, ?, 'code-review', 'running', ?)`,
    [taskId, task.workflow_state, task.workflow_state, task.retry_count + 1],
  );
  const executionId = execResult.lastInsertRowid as number;

  db.run(
    "UPDATE tasks SET execution_state = 'running', current_execution_id = ? WHERE id = ?",
    [executionId, taskId],
  );

  const runningRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
  onTaskUpdated(mapTask(runningRow));

  const reviewMsgRow = db
    .query<ConversationMessageRow, [number]>(
      "SELECT * FROM conversation_messages WHERE id = ?",
    )
    .get(reviewMsgId)!;

  // Notify frontend of the code_review message
  onNewMessage(mapConversationMessage(reviewMsgRow));

  const controller = new AbortController();
  executionControllers.set(executionId, controller);

  const resolvedModel = task.model ?? "";

  runExecution(
    taskId,
    executionId,
    llmText,
    column?.stage_instructions,
    resolvedModel,
    controller.signal,
    onToken,
    onError,
    onTaskUpdated,
    onNewMessage,
  ).catch(() => { });

  return { message: mapConversationMessage(reviewMsgRow), executionId };
}
