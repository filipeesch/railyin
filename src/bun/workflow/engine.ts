import { getDb } from "../db/index.ts";
import { getConfig } from "../config/index.ts";
import { createProvider } from "../ai/index.ts";
import type { AIMessage } from "../ai/types.ts";
import type { Task, ConversationMessage, MessageType } from "../../shared/rpc-types.ts";
import type { TaskRow, ConversationMessageRow, TaskGitContextRow } from "../db/row-types.ts";
import { mapTask, mapConversationMessage } from "../db/mappers.ts";
import { TOOL_DEFINITIONS, executeTool } from "./tools.ts";

// ─── Constants ────────────────────────────────────────────────────────────────

// Task 5.5: Tool results larger than this (in chars, ~1 token ≈ 4 chars) are truncated
const TOOL_RESULT_MAX_CHARS = 8_000; // ~2,000 tokens

// Task 5.6: Warn when assembled context exceeds this fraction of the context window
const CONTEXT_WARN_FRACTION = 0.8;

// ─── Streaming callback type ──────────────────────────────────────────────────

export type OnToken = (taskId: number, executionId: number, token: string, done: boolean) => void;
export type OnError = (taskId: number, executionId: number, error: string) => void;
export type OnTaskUpdated = (task: Task) => void;

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
      "You have access to the following tools to inspect the project files:",
      "- list_dir(path): list files/directories relative to the worktree root",
      "- read_file(path): read the contents of a file",
      "- run_command(command): run a read-only shell command (grep, git log, git diff, etc.)",
      "",
      "Use these tools to understand the codebase before responding.",
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

  // 8. Run async (non-blocking)
  const updatedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
  runExecution(taskId, executionId, column.on_enter_prompt, column.stage_instructions, onToken, onError, onTaskUpdated).catch(
    () => {},
  );

  return { task: mapTask(updatedRow), executionId };
}

// ─── Task 5.2 + 5.3: Execute prompt ──────────────────────────────────────────

async function runExecution(
  taskId: number,
  executionId: number,
  prompt: string,
  stageInstructions: string | undefined,
  onToken: OnToken,
  onError: OnError,
  onTaskUpdated: OnTaskUpdated,
): Promise<void> {
  const db = getDb();

  try {
    const task = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId)!;
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
    const provider = createProvider(config.workspace.ai);

    // ── Tool-call loop ────────────────────────────────────────────────────────
    // Run non-streaming turns until the model stops issuing tool calls, then
    // stream the final text response to the user.
    const MAX_TOOL_ROUNDS = 10;
    const toolCtx = gitContext?.worktree_path
      ? { worktreePath: gitContext.worktree_path }
      : null;

    // Whether to offer tools (only when a worktree is available)
    const tools = toolCtx ? TOOL_DEFINITIONS : [];

    // Live messages list — we'll extend it with tool rounds
    const liveMessages: AIMessage[] = [...messages];
    // If the model returns text directly from a non-streaming turn(), capture it here
    // so we can skip the redundant chat() streaming call.
    let turnTextResponse: string | null = null;

    // Only run the non-streaming tool loop when tools are actually available.
    // Without tools, go straight to the streaming response to avoid an extra round-trip.
    if (tools.length > 0) {
      let toolRounds = 0;
      while (toolRounds < MAX_TOOL_ROUNDS) {
        const turn = await provider.turn(liveMessages, { tools });

        if (turn.type === "text") {
          // Model is done with tool calls — capture the final text so we don't
          // need an extra chat() round-trip that would cause the model to re-read
          // tool results and echo them back instead of giving a real answer.
          turnTextResponse = turn.content ?? null;
          break;
        }

        // Model issued tool calls — execute each one
        toolRounds++;

        // Append the assistant tool-call message to the live context
        liveMessages.push({
          role: "assistant",
          content: "",
          tool_calls: turn.calls,
        });

        // Execute each tool and append results
        for (const call of turn.calls) {
          const fnName = call.function.name;
          const fnArgs = call.function.arguments;

          // Surface the tool call in the conversation log (collapsed in UI)
          appendMessage(
            taskId,
            task.conversation_id ?? 0,
            "tool_call",
            null,
            JSON.stringify({ name: fnName, arguments: fnArgs }),
          );

          const result = executeTool(fnName, fnArgs, toolCtx!);

          // Truncate large results before storing
          const storedResult = result.length > TOOL_RESULT_MAX_CHARS
            ? result.slice(0, TOOL_RESULT_MAX_CHARS) + "\n\n[truncated]"
            : result;

          appendMessage(
            taskId,
            task.conversation_id ?? 0,
            "tool_result",
            null,
            storedResult,
            { tool_call_id: call.id, name: fnName },
          );

          // Add tool result to live context for next turn
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

    // ── Stream the final text response ────────────────────────────────────────
    let fullResponse = "";

    try {
      if (turnTextResponse !== null) {
        // Model already returned its final answer in the non-streaming turn() call.
        // Emit it token-by-token so the UI sees the streaming behaviour, then we're done.
        // (Calling chat() again here would cause the model to re-read tool results and echo them.)
        for (const char of turnTextResponse) {
          fullResponse += char;
          onToken(taskId, executionId, char, false);
        }
      } else {
        // No tool loop ran (or loop hit the round limit) — stream the final answer.
        for await (const token of provider.chat(liveMessages, {})) {
          fullResponse += token;
          onToken(taskId, executionId, token, false);
        }
      }
    } catch (streamErr) {
      // On stream error, retain partial response and mark failed
      if (fullResponse) {
        appendMessage(taskId, task.conversation_id ?? 0, "assistant", "assistant", fullResponse);
      }
      const errMsg = streamErr instanceof Error ? streamErr.message : String(streamErr);
      appendMessage(taskId, task.conversation_id ?? 0, "system", null, `Stream error: ${errMsg}`);
      db.run(
        "UPDATE tasks SET execution_state = 'failed' WHERE id = ?",
        [taskId],
      );
      db.run(
        "UPDATE executions SET status = 'failed', finished_at = datetime('now'), details = ? WHERE id = ?",
        [errMsg, executionId],
      );
      onError(taskId, executionId, errMsg);
      // Notify frontend of failed state
      const failedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
      if (failedRow) onTaskUpdated(mapTask(failedRow));
      return;
    }

    // Append full assistant response to conversation BEFORE signalling done,
    // so the DB is ready if the frontend calls loadMessages immediately.
    appendMessage(taskId, task.conversation_id ?? 0, "assistant", "assistant", fullResponse);

    // Signal streaming done
    onToken(taskId, executionId, "", true);

    // Task 5.6: Default execution result to completed
    // (In future, parse structured result from response)
    db.run(
      "UPDATE tasks SET execution_state = 'completed' WHERE id = ?",
      [taskId],
    );
    db.run(
      "UPDATE executions SET status = 'completed', finished_at = datetime('now'), summary = ? WHERE id = ?",
      [fullResponse.slice(0, 500), executionId],
    );
    // Notify frontend that execution is complete
    const completedRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
    if (completedRow) onTaskUpdated(mapTask(completedRow));
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const task = db.query<{ conversation_id: number }, [number]>(
      "SELECT conversation_id FROM tasks WHERE id = ?",
    ).get(taskId);
    if (task) {
      appendMessage(taskId, task.conversation_id, "system", null, `Execution error: ${errMsg}`);
    }
    db.run("UPDATE tasks SET execution_state = 'failed' WHERE id = ?", [taskId]);
    db.run(
      "UPDATE executions SET status = 'failed', finished_at = datetime('now'), details = ? WHERE id = ?",
      [errMsg, executionId],
    );
    onError(taskId, executionId, errMsg);
    // Notify frontend of failed state
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

  // Run async
  runExecution(taskId, executionId, content, column?.stage_instructions, onToken, onError, onTaskUpdated).catch(
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

  runExecution(
    taskId,
    executionId,
    column?.on_enter_prompt ?? "Please continue with the task.",
    column?.stage_instructions,
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
