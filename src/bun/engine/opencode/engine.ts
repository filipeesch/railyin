import type {
  ExecutionEngine,
  ExecutionParams,
  EngineEvent,
  EngineModelInfo,
  EngineResumeInput,
  CommandInfo,
  OnTaskUpdated,
  OnNewMessage,
} from "../types.ts";
import type { OpenCodeSdkAdapter } from "./types.ts";
import { TodoRepository } from "../../db/todos.ts";
import { DecisionRepository } from "../../db/repositories/decision-repository.ts";
import { NoteRepository } from "../../db/repositories/note-repository.ts";
import { getDefaultWorkspaceKey } from "../../workspace-context.ts";
import type { CommonToolContext } from "../types.ts";


export class OpenCodeEngine implements ExecutionEngine {
  private readonly sdkAdapter: OpenCodeSdkAdapter;
  private readonly _onTaskUpdated: OnTaskUpdated;
  private readonly pendingResumes = new Map<number, {
    resolve: (input: EngineResumeInput) => void;
    reject: (error: Error) => void;
  }>();

  constructor(
    onTaskUpdated: OnTaskUpdated,
    _onNewMessage: OnNewMessage,
    sdkAdapter: OpenCodeSdkAdapter,
  ) {
    this._onTaskUpdated = onTaskUpdated;
    this.sdkAdapter = sdkAdapter;
  }

  execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
    return this.createManagedExecution(params);
  }

  private async *createManagedExecution(params: ExecutionParams): AsyncGenerator<EngineEvent> {
    const {
      executionId,
      taskId,
      boardId,
      conversationId,
      workingDirectory,
      model,
      prompt,
      signal,
      systemInstructions,
      taskContext,
      attachments,
      onRawModelMessage,
      onTransition,
      onHumanTurn,
      boardTools,
      workspaceKey,
    } = params;

    const sessionId = await this.sdkAdapter.getOrCreateSession(conversationId, workingDirectory);

    const taskBlock = taskContext
      ? [`## Task`, `**Title:** ${taskContext.title}`, ...(taskContext.description ? [`**Description:** ${taskContext.description}`] : [])].join("\n")
      : undefined;
    const enrichedSystemInstructions = [taskBlock, systemInstructions].filter(Boolean).join("\n\n") || undefined;

    const commonToolContext: CommonToolContext = {
      task: {
        id: taskId,
        boardId: boardId ?? null,
        conversationId,
      },
      repos: {
        todos: new TodoRepository(),
        decisions: new DecisionRepository(),
        notes: new NoteRepository(),
        boardTools: boardTools!,
      },
      workspaceKey: workspaceKey ?? getDefaultWorkspaceKey(),
      workflow: {
        onTransition: onTransition ?? (() => {}),
        onHumanTurn: onHumanTurn ?? (() => {}),
        onCancel: (id) => this.cancel(id),
        onTaskUpdated: (task) => this._onTaskUpdated(task),
      },
      runtime: {
        worktreePath: workingDirectory,
      },
    };

    const onRawEvent = onRawModelMessage
      ? (event: Record<string, unknown>) => {
          onRawModelMessage({
            engine: "opencode",
            sessionId,
            direction: "inbound",
            eventType: typeof event.type === "string" ? event.type : "unknown",
            payload: event,
          });
        }
      : undefined;

    try {
      for await (const event of this.sdkAdapter.run({
        executionId,
        conversationId,
        sessionId,
        prompt,
        systemInstructions: enrichedSystemInstructions,
        model,
        workingDirectory,
        attachments,
        signal,
        commonToolContext,
        onRawEvent,
      })) {
        if (event.type === "shell_approval") {
          yield event;
          try {
            await this.waitForResume(executionId, { type: "shell_approval" }, signal);
          } catch {
            return;
          }
          continue;
        }

        yield event;
      }
    } finally {
      this.pendingResumes.delete(executionId);
    }
  }

  async resume(executionId: number, input: EngineResumeInput): Promise<void> {
    if (input.type === "ask_user") {
      // Route through the adapter: resolves the MCP long-poll HTTP response so OpenCode
      // can continue the agent loop. Throws if no pending ask_user (e.g. after restart),
      // which causes human-turn-executor to create a fresh execution.
      await this.sdkAdapter.respondAskUser(executionId, input.content);
      return;
    }
    // shell_approval: unblock the in-engine waitForResume AND reply to OpenCode's permission request
    const pending = this.pendingResumes.get(executionId);
    if (!pending) {
      throw new Error(`Execution ${executionId} is not waiting for resume input`);
    }
    this.pendingResumes.delete(executionId);
    pending.resolve(input);
    await this.sdkAdapter.respondPermission(executionId, input.decision);
  }

  cancel(executionId: number): void {
    const pending = this.pendingResumes.get(executionId);
    if (pending) {
      this.pendingResumes.delete(executionId);
      pending.reject(new Error(`Execution ${executionId} cancelled`));
    }
    void this.sdkAdapter.cancel(executionId).catch(() => {});
  }

  async listModels(): Promise<EngineModelInfo[]> {
    return this.sdkAdapter.listModels(process.cwd());
  }

  async listCommands(taskId: number): Promise<CommandInfo[]> {
    const { getDb } = await import("../../db/index.ts");
    const { getDefaultWorkspaceKey } = await import("../../workspace-context.ts");
    const { getLoadedProjectByKey } = await import("../../project-store.ts");

    const db = getDb();
    const taskRow = db
      .query<{ board_id: number; project_key: string }, [number]>(
        "SELECT board_id, project_key FROM tasks WHERE id = ?",
      )
      .get(taskId);

    if (!taskRow) return [];

    const gitRow = db
      .query<{ worktree_path: string | null }, [number]>(
        "SELECT worktree_path FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);

    const wsKey =
      db.query<{ workspace_key: string }, [number]>(
        "SELECT workspace_key FROM boards WHERE id = ?",
      ).get(taskRow.board_id)?.workspace_key ?? getDefaultWorkspaceKey();
    const project = getLoadedProjectByKey(wsKey, taskRow.project_key);
    const cwd = project?.projectPath || gitRow?.worktree_path || process.cwd();

    return this.sdkAdapter.listCommands(cwd);
  }

  async compact(taskId: number | null, conversationId: number, workingDirectory: string): Promise<void> {
    const sessionId = await this.sdkAdapter.getOrCreateSession(conversationId, workingDirectory);
    await this.sdkAdapter.compact(sessionId, workingDirectory);
  }

  async shutdown(): Promise<void> {
    await this.sdkAdapter.shutdown();
  }

  private waitForResume(
    executionId: number,
    _request: { type: "ask_user" | "shell_approval" },
    signal?: AbortSignal,
  ): Promise<EngineResumeInput> {
    return new Promise<EngineResumeInput>((resolve, reject) => {
      const existing = this.pendingResumes.get(executionId);
      if (existing) {
        reject(new Error(`Execution ${executionId} is already waiting for resume input`));
        return;
      }

      const cleanup = () => {
        signal?.removeEventListener("abort", onAbort);
        this.pendingResumes.delete(executionId);
      };

      const onAbort = () => {
        cleanup();
        reject(new Error(`Execution ${executionId} aborted while waiting for input`));
      };

      signal?.addEventListener("abort", onAbort, { once: true });
      this.pendingResumes.set(executionId, {
        resolve: (input) => { cleanup(); resolve(input); },
        reject: (error) => { cleanup(); reject(error); },
      });
    });
  }
}
