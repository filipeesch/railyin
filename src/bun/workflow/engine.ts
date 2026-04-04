import { getDb } from "../db/index.ts";
import { getConfig } from "../config/index.ts";
import { createProvider } from "../ai/index.ts";
import type { AIMessage } from "../ai/types.ts";
import type { Task, ConversationMessage, MessageType } from "../../shared/rpc-types.ts";
import type { TaskRow, ConversationMessageRow, TaskGitContextRow } from "../db/row-types.ts";
import { mapTask, mapConversationMessage } from "../db/mappers.ts";
import { resolveToolsForColumn, executeTool, type WriteResult } from "./tools.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

// Task 5.5: Tool results larger than this (in chars, ~1 token ≈ 4 chars) are truncated
const TOOL_RESULT_MAX_CHARS = 8_000; // ~2,000 tokens

// Task 5.6: Warn when assembled context exceeds this fraction of the context window
const CONTEXT_WARN_FRACTION = 0.8;

// ─── Streaming callback type ──────────────────────────────────────────────────

export type OnToken = (taskId: number, executionId: number, token: string, done: boolean) => void;
export type OnError = (taskId: number, executionId: number, error: string) => void;
export type OnTaskUpdated = (task: Task) => void;

// ─── Cancellation map ─────────────────────────────────────────────────────────
// Keyed by executionId. Populated at execution start, removed on finish.

const executionControllers = new Map<number, AbortController>();

export function cancelExecution(executionId: number): void {
  const controller = executionControllers.get(executionId);
  if (controller) controller.abort();
}

// ─── Helper: get column config ────────────────────────────────────────────────

function getColumnConfig(templateId: string, columnId: string) {
  const config = getConfig();
  const template = config.workflows.find((w) => w.id === templateId);
  return template?.columns.find((c) => c.id === columnId) ?? null;
}

export function getBoardTemplateId(boardId: number): string {
  const db = getDb();
  const board = db
    .query<{ workflow_template_id: string }, [number]>(
      "SELECT workflow_template_id FROM boards WHERE id = ?",
    )
    .get(boardId);
  return board?.workflow_template_id ?? "delivery";
}

// ─── Task 5.5: Context compaction ────────────────────────────────────────────

function compactMessages(messages: ConversationMessageRow[]): AIMessage[] {
  return messages
    .filter(
      (m) =>
        m.type === "user" ||
        m.type === "assistant" ||
        m.type === "system" ||
        m.type === "tool_call" ||
        m.type === "tool_result",
        // "file_diff" is intentionally excluded — UI-only, never sent to LLM
    )
    .map((m) => {
      let content = m.content;

      // Truncate tool_result messages that exceed the token budget
      if (m.type === "tool_result" && content.length > TOOL_RESULT_MAX_CHARS) {
        const kept = content.slice(0, TOOL_RESULT_MAX_CHARS);
        content = `${kept}\n\n[truncated — full content stored in conversation history]`;
      }

      return {
        role: (m.role as "user" | "assistant" | "system") ?? "user",
        content,
      };
    });
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
): AIMessage[] {
  const messages: AIMessage[] = [];

  // Always inject stage_instructions as first system message
  if (stageInstructions) {
    messages.push({ role: "system", content: stageInstructions });
  }

  // Task 6.5: Inject git/worktree context when worktree is ready
  if (gitContext?.worktree_status === "ready" && gitContext.worktree_path) {
    const lines = [
      "## Worktree context",
      `You are working inside a dedicated Git worktree for this task.`,
      `- worktree_path: ${gitContext.worktree_path}`,
      `- git_root_path: ${gitContext.git_root_path}`,
      `- project_path:  ${gitContext.project_path}`,
      "",
      "You have access to the following tools to work with the project files:",
      "",
      "**Read tools:**",
      "- list_dir(path): list files/directories relative to the worktree root",
      "- read_file(path, start_line?, end_line?): read a file; use start_line/end_line (1-based) for partial reads of large files",
      "",
      "**Write tools:**",
      "- write_file(path, content): create or fully overwrite a file",
      "- patch_file(path, content, position, anchor?): targeted edit — position is start/end/before/after/replace; anchor required for before/after/replace and must appear exactly once",
      "- delete_file(path): delete a file",
      "- rename_file(from_path, to_path): move or rename a file",
      "",
      "**Search tools:**",
      "- search_text(pattern, glob?, context_lines?): grep for a text/regex pattern; context_lines shows N lines around each match",
      "- find_files(glob): find files matching a glob pattern",
      "",
      "**Web tools:**",
      "- fetch_url(url): fetch a public URL and return its text content",
      "- search_internet(query): search the web (requires search config in workspace.yaml)",
      "",
      "**Shell tool:**",
      "- run_command(command): run a read-only shell command (grep, git log, git diff, etc.) — write redirections are blocked",
      "",
      "**Interaction tool:**",
      "- ask_me(question, selection_mode, options): pause and ask me a question",
      "",
      "**Agent tool:**",
      "- spawn_agent(children): run parallel sub-agents in this worktree; each child gets its own instructions and tools",
      "",
      "Always read before you write. Use patch_file for targeted edits to existing files.",
    ];
    messages.push({ role: "system", content: lines.join("\n") });
  }

  // Compacted conversation history
  messages.push(...compactMessages(history));

  // The triggering message
  messages.push({ role: "user", content: newMessage });

  return messages;
}

// ─── Task 5.6: Context size warning ──────────────────────────────────────────

export function estimateContextWarning(taskId: number): string | null {
  const db = getDb();
  const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) return null;

  const config = getConfig();
  const contextWindowTokens = config.workspace.ai.context_window_tokens ?? 128_000;
  const warnAt = Math.floor(contextWindowTokens * CONTEXT_WARN_FRACTION);

  const messages = db
    .query<ConversationMessageRow, [number]>(
      "SELECT * FROM conversation_messages WHERE task_id = ? ORDER BY created_at ASC",
    )
    .all(taskId);

  const totalChars = messages.reduce((sum, m) => sum + m.content.length, 0);
  const estimatedTokens = Math.floor(totalChars / 4);

  if (estimatedTokens >= warnAt) {
    return `Context is ~${estimatedTokens.toLocaleString()} tokens (${Math.round((estimatedTokens / contextWindowTokens) * 100)}% of model limit). Consider archiving this task's conversation.`;
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

// ─── Task 5.1: Transition handler ─────────────────────────────────────────────

export async function handleTransition(
  taskId: number,
  toState: string,
  onToken: OnToken,
  onError: OnError,
  onTaskUpdated: OnTaskUpdated,
): Promise<{ task: Task; executionId: number | null }> {
  const db = getDb();

  const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  const fromState = task.workflow_state;

  // 1. Update workflow_state immediately (design D6)
  db.run("UPDATE tasks SET workflow_state = ? WHERE id = ?", [toState, taskId]);

  // 2. Append transition event to conversation
  appendMessage(task.conversation_id!, task.conversation_id!, "transition_event", null, "", {
    from: fromState,
    to: toState,
  });

  // 3. Get column config for the destination column
  const templateId = getBoardTemplateId(task.board_id);
  const column = getColumnConfig(templateId, toState);

  // Resolve and persist the model for this column (D1)
  const config = getConfig();
  const resolvedModel = column?.model ?? config.workspace.ai.model;
  db.run("UPDATE tasks SET model = ? WHERE id = ?", [resolvedModel, taskId]);

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
    task.conversation_id!,
    "system",
    null,
    `Running prompt: ${column.id}`,
  );

  // 8. Register AbortController for cancellation (D3)
  const controller = new AbortController();
  executionControllers.set(executionId, controller);

  // 9. Run async (non-blocking)
  const updatedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
  runExecution(taskId, executionId, column.on_enter_prompt, column.stage_instructions, resolvedModel, controller.signal, onToken, onError, onTaskUpdated).catch(
    () => {},
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
}: {
  worktreePath: string;
  instructions: string;
  tools: string[];
}): Promise<string> {
  const config = getConfig();
  const provider = createProvider(config.workspace.ai);
  const toolCtx = { worktreePath, searchConfig: config.workspace.search };
  const toolDefs = resolveToolsForColumn(tools);

  const liveMessages: AIMessage[] = [
    { role: "user", content: instructions },
  ];

  const MAX_SUB_ROUNDS = 10;
  let toolRounds = 0;

  while (toolRounds < MAX_SUB_ROUNDS) {
    const turn = await provider.turn(liveMessages, { tools: toolDefs });

    if (turn.type === "text") {
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
      const result = await executeTool(fnName, call.function.arguments, toolCtx);
      const llmStr = typeof result === "object" && result !== null && "content" in result
        ? (result as WriteResult).content
        : result as string;
      const stored = llmStr.length > TOOL_RESULT_MAX_CHARS
        ? llmStr.slice(0, TOOL_RESULT_MAX_CHARS) + "\n\n[truncated]"
        : llmStr;
      liveMessages.push({
        role: "tool",
        content: stored,
        tool_call_id: call.id,
        name: fnName,
      });
    }
  }

  // Hit round limit — ask for a summary
  liveMessages.push({
    role: "user",
    content: "You have reached the tool call limit. Please summarise your work so far.",
  });
  const final = await provider.turn(liveMessages, { tools: [] });
  return final.type === "text" ? (final.content ?? "(no response)") : "(sub-agent hit tool limit)";
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
): Promise<void> {
  const db = getDb();

  // Helper: handle cancellation — tidy up DB and notify frontend
  function handleCancelled(task: { conversation_id: number | null }): void {
    executionControllers.delete(executionId);
    db.run("UPDATE tasks SET execution_state = 'waiting_user' WHERE id = ?", [taskId]);
    db.run(
      "UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE id = ?",
      [executionId],
    );
    const cancelledRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (cancelledRow) onTaskUpdated(mapTask(cancelledRow));
  }

  try {
    const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
    const templateId = getBoardTemplateId(task.board_id);
    const column = getColumnConfig(templateId, task.workflow_state);
    const history = db
      .query<ConversationMessageRow, [number]>(
        "SELECT * FROM conversation_messages WHERE task_id = ? ORDER BY created_at ASC",
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
      const projectRow = db
        .query<{ project_path: string }, [number]>(
          "SELECT project_path FROM projects WHERE id = ?",
        )
        .get(task.project_id);
      if (projectRow) {
        gitContext = {
          git_root_path: gitRow.git_root_path,
          worktree_path: gitRow.worktree_path,
          worktree_status: gitRow.worktree_status,
          project_path: projectRow.project_path,
        };
      }
    }

    // Task 5.3: Assemble full execution payload as messages
    const messages = assembleMessages(task, stageInstructions, history, prompt, gitContext);

    const config = getConfig();
    // Use the task-level model override (D1 + D3)
    const provider = createProvider({ ...config.workspace.ai, model });

    // ── Tool-call loop ────────────────────────────────────────────────────────
    const MAX_TOOL_ROUNDS = 10;
    const toolCtx = gitContext?.worktree_path
      ? { worktreePath: gitContext.worktree_path, searchConfig: config.workspace.search }
      : null;

    const tools = toolCtx ? resolveToolsForColumn(column?.tools) : [];
    const liveMessages: AIMessage[] = [...messages];

    if (tools.length > 0) {
      let toolRounds = 0;
      while (toolRounds < MAX_TOOL_ROUNDS) {
        // Check for cancellation between turns
        if (signal.aborted) {
          handleCancelled(task);
          return;
        }

        const turn = await provider.turn(liveMessages, { tools, signal });

        if (turn.type === "text") {
          // Model is done with tools — stream the final response via chat() below
          break;
        }

        toolRounds++;

        liveMessages.push({
          role: "assistant",
          content: "",
          tool_calls: turn.calls,
        });

        // Intercept ask_me before executing any tools — it suspends execution
        const askUserCall = turn.calls.find((c) => c.function.name === "ask_me");
        if (askUserCall) {
          let payload: { question: string; selection_mode: string; options: string[] };
          try {
            payload = JSON.parse(askUserCall.function.arguments);
          } catch {
            payload = { question: askUserCall.function.arguments, selection_mode: "single", options: [] };
          }
          appendMessage(
            taskId,
            task.conversation_id ?? 0,
            "ask_user_prompt" as MessageType,
            null,
            JSON.stringify(payload),
          );
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

        // Intercept spawn_agent
        const spawnCall = turn.calls.find((c) => c.function.name === "spawn_agent");
        if (spawnCall && toolCtx) {
          let spawnArgs: { children: Array<{ instructions: string; tools: string[]; scope?: string }> };
          try {
            spawnArgs = JSON.parse(spawnCall.function.arguments);
          } catch {
            spawnArgs = { children: [] };
          }

          const childResults = await Promise.all(
            (spawnArgs.children ?? []).map(async (child, idx) => {
              try {
                const result = await runSubExecution({
                  worktreePath: toolCtx.worktreePath,
                  instructions: child.instructions,
                  tools: child.tools,
                });
                return `[Agent ${idx + 1}${child.scope ? ` (${child.scope})` : ""}]: ${result}`;
              } catch (e) {
                return `[Agent ${idx + 1}${child.scope ? ` (${child.scope})` : ""}]: Error — ${e instanceof Error ? e.message : String(e)}`;
              }
            }),
          );

          const spawnResultStr = JSON.stringify(childResults);
          const stored = spawnResultStr.length > TOOL_RESULT_MAX_CHARS
            ? spawnResultStr.slice(0, TOOL_RESULT_MAX_CHARS) + "\n\n[truncated]"
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

        for (const call of turn.calls) {
          const fnName = call.function.name;
          const fnArgs = call.function.arguments;

          appendMessage(
            taskId,
            task.conversation_id ?? 0,
            "tool_call",
            null,
            JSON.stringify({ name: fnName, arguments: fnArgs }),
          );

          const result = await executeTool(fnName, fnArgs, toolCtx!);

          // Write tools return { content, diff }; read/search tools return a plain string
          const isWriteResult = typeof result === "object" && result !== null && "content" in result;
          const llmContent = isWriteResult ? (result as WriteResult).content : result as string;
          const diff = isWriteResult ? (result as WriteResult).diff : undefined;

          const storedResult = llmContent.length > TOOL_RESULT_MAX_CHARS
            ? llmContent.slice(0, TOOL_RESULT_MAX_CHARS) + "\n\n[truncated]"
            : llmContent;

          appendMessage(
            taskId,
            task.conversation_id ?? 0,
            "tool_result",
            null,
            storedResult,
            { tool_call_id: call.id, name: fnName },
          );

          // Emit UI-only file_diff message (never forwarded to LLM)
          if (diff) {
            appendMessage(
              taskId,
              task.conversation_id ?? 0,
              "file_diff",
              null,
              JSON.stringify(diff),
            );
          }

          liveMessages.push({
            role: "tool",
            content: storedResult,
            tool_call_id: call.id,
            name: fnName,
          });
        }
      }

      if (toolRounds >= MAX_TOOL_ROUNDS) {
        liveMessages.push({
          role: "user",
          content: "You have reached the tool call limit. Please summarise your findings and respond now.",
        });
      }
    }

    // Check cancellation before streaming
    if (signal.aborted) {
      handleCancelled(task);
      return;
    }

    // ── Stream the final text response ────────────────────────────────────────
    // Always use provider.chat() (true async streaming). When the tool-call loop
    // exited because the model returned text (no tool calls), liveMessages holds
    // everything up to that point; chat() re-requests the same final answer with
    // streaming so tokens are delivered progressively to the UI.
    let fullResponse = "";

    try {
      for await (const token of provider.chat(liveMessages, { signal })) {
        fullResponse += token;
        onToken(taskId, executionId, token, false);
      }
    } catch (streamErr) {
      // Distinguish abort from real stream errors
      if (streamErr instanceof Error && streamErr.name === "AbortError") {
        if (fullResponse) {
          appendMessage(taskId, task.conversation_id ?? 0, "assistant", "assistant", fullResponse);
        }
        handleCancelled(task);
        return;
      }
      if (fullResponse) {
        appendMessage(taskId, task.conversation_id ?? 0, "assistant", "assistant", fullResponse);
      }
      const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
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

    // If signal aborted mid-stream (turnTextResponse path)
    if (signal.aborted) {
      if (fullResponse) {
        appendMessage(taskId, task.conversation_id ?? 0, "assistant", "assistant", fullResponse);
      }
      handleCancelled(task);
      return;
    }

    appendMessage(taskId, task.conversation_id ?? 0, "assistant", "assistant", fullResponse);
    onToken(taskId, executionId, "", true);

    executionControllers.delete(executionId);
    db.run("UPDATE tasks SET execution_state = 'completed' WHERE id = ?", [taskId]);
    db.run(
      "UPDATE executions SET status = 'completed', finished_at = datetime('now'), summary = ? WHERE id = ?",
      [fullResponse.slice(0, 500), executionId],
    );
    const completedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (completedRow) onTaskUpdated(mapTask(completedRow));
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
  }
}
// ─── Task 5.7: Human turn ─────────────────────────────────────────────────────

export async function handleHumanTurn(
  taskId: number,
  content: string,
  onToken: OnToken,
  onError: OnError,
  onTaskUpdated: OnTaskUpdated,
): Promise<{ message: ConversationMessage; executionId: number }> {
  const db = getDb();
  const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
  if (!task) throw new Error(`Task ${taskId} not found`);

  // Append user message
  const msgId = appendMessage(
    taskId,
    task.conversation_id ?? 0,
    "user",
    "user",
    content,
  );

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

  // Resolve model: use the task's persisted model (D1) or workspace default
  const config = getConfig();
  const resolvedModel = task.model ?? config.workspace.ai.model;

  // Run async
  runExecution(taskId, executionId, content, column?.stage_instructions, resolvedModel, controller.signal, onToken, onError, onTaskUpdated).catch(
    () => {},
  );

  return { message: mapConversationMessage(msgRow), executionId };
}

// ─── Task 5.9: Retry ──────────────────────────────────────────────────────────

export async function handleRetry(
  taskId: number,
  onToken: OnToken,
  onError: OnError,
  onTaskUpdated: OnTaskUpdated,
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

  // Resolve model: use the task's persisted model or workspace default
  const config = getConfig();
  const resolvedModel = updatedRow.model ?? config.workspace.ai.model;

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
  ).catch(() => {});

  return { task: mapTask(updatedRow), executionId };
}

// ─── Task 5.10: Handle spawned tasks from execution result ─────────────────────

export function createSpawnedTask(params: {
  boardId: number;
  projectId: number;
  title: string;
  description: string;
  createdFromTaskId: number;
  createdFromExecutionId: number;
}): Task {
  const db = getDb();

  const convResult = db.run("INSERT INTO conversations (task_id) VALUES (0)");
  const conversationId = convResult.lastInsertRowid as number;

  const taskResult = db.run(
    `INSERT INTO tasks
       (board_id, project_id, title, description, workflow_state, execution_state,
        conversation_id, created_from_task_id, created_from_execution_id)
     VALUES (?, ?, ?, ?, 'backlog', 'idle', ?, ?, ?)`,
    [
      params.boardId,
      params.projectId,
      params.title,
      params.description,
      conversationId,
      params.createdFromTaskId,
      params.createdFromExecutionId,
    ],
  );
  const newTaskId = taskResult.lastInsertRowid as number;

  // Update conversation to point to real task
  db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [newTaskId, conversationId]);

  appendMessage(newTaskId, conversationId, "system", null, "Task created from execution result", {
    createdFromTaskId: params.createdFromTaskId,
    createdFromExecutionId: params.createdFromExecutionId,
  });

  const newRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(newTaskId)!;
  return mapTask(newRow);
}
