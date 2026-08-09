import type {
  ExecutionEngine,
  ExecutionParams,
  EngineEvent,
  EngineModelInfo,
  CommandInfo,
  OnTaskUpdated,
} from "../types.ts";
import type { OpenCodeSdkAdapter, PermissionDecision } from "./types.ts";
import { TodoRepository } from "../../db/todos.ts";
import { DecisionRepository } from "../../db/repositories/decision-repository.ts";
import { NoteRepository } from "../../db/repositories/note-repository.ts";
import { ShellApprovalRepository, type ShellApprovalScope } from "../../db/repositories/shell-approval-repository.ts";
import { getDefaultWorkspaceKey } from "../../workspace-context.ts";
import type { CommonToolContext } from "../types.ts";


export class OpenCodeEngine implements ExecutionEngine {
  readonly type = "opencode";
  private readonly sdkAdapter: OpenCodeSdkAdapter;
  private readonly _onTaskUpdated: OnTaskUpdated;
  private readonly shellApprovalRepo: ShellApprovalRepository;

  constructor(
    onTaskUpdated: OnTaskUpdated,
    sdkAdapter: OpenCodeSdkAdapter,
    shellApprovalRepo?: ShellApprovalRepository,
  ) {
    this._onTaskUpdated = onTaskUpdated;
    this.sdkAdapter = sdkAdapter;
    this.shellApprovalRepo = shellApprovalRepo ?? new ShellApprovalRepository();
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
      onTransition,
      onHumanTurn,
      boardTools,
      workspaceKey,
    } = params;

    const sessionId = await this.sdkAdapter.getOrCreateSession(conversationId, workingDirectory);

    const shellScope: ShellApprovalScope = params.taskId != null
      ? { kind: "task", taskId: params.taskId }
      : { kind: "chat", conversationId: params.conversationId };

    // A3 posture: permission requests are answered deterministically — auto-approve
    // when shellAutoApprove is configured (tasks.setShellAutoApprove / workspace
    // shell_auto_approve), deny otherwise. NEVER wait: no UI can answer a
    // permission request (decision_request is the only HITL channel). The reply
    // happens in the adapter at permission.asked time via this callback.
    const onPermissionAsked = async (_executionId: number): Promise<PermissionDecision> => {
      const shellState = this.shellApprovalRepo.getState(shellScope);
      return shellState.shellAutoApprove ? "approve_all" : "deny";
    };

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
      workspaceKey: params.workspaceKey!,
      workflow: {
        onTransition: onTransition ?? (() => {}),
        onHumanTurn: onHumanTurn ?? (() => {}),
        onCancel: (id) => this.cancel(id),
        onTaskUpdated: (task) => this._onTaskUpdated(task),
      },
      runtime: {
        worktreePath: workingDirectory,
        mcpRegistry: params.mcpRegistry ?? undefined,
        mcpEnabledTools: params.enabledMcpTools ?? null,
      },
    };

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
        onPermissionAsked,
      })) {
        yield event;
      }
    } finally {
      // no per-execution resume state to clean up (ask_user/shell_approval trimmed)
    }
  }

  async resume(_executionId: number, _input: never): Promise<void> {
    // All engine-level resume channels were trimmed with ask_user/shell_approval
    // (EngineResumeInput deleted). Decision interrupts resume via a NEW turn —
    // executeChatTurn/executeHumanTurn deliver the answer as engineContent —
    // never through engine.resume().
  }

  cancel(executionId: number): void {
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
}
