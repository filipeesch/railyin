/**
 * PiToolFactory — manages harness contexts, common tool contexts, and tool construction.
 *
 * A HarnessContext holds per-conversation state (undo stack, loop detector, working
 * directory). A CommonToolContext provides the board/workflow/runtime hooks shared by
 * every common tool. Both are created lazily on first use and reused across turns.
 */

import type { PiEngineConfig } from "../../config/index.ts";
import type { OnTaskUpdated, EngineEvent, ExecutionParams, CommonToolContext } from "../types.ts";
import type { HarnessContext } from "./harness/context.ts";
import { UndoStack } from "./harness/undo-stack.ts";
import { ToolLoopDetector } from "./harness/tool-loop-detector.ts";
import { buildAllTools, type AllToolsOptions, type ChildSpawnOptions } from "./tools/index.ts";
import { TodoRepository } from "../../db/todos.ts";
import { DecisionRepository } from "../../db/repositories/decision-repository.ts";
import { NoteRepository } from "../../db/repositories/note-repository.ts";
import { taskLspRegistry } from "../../lsp/task-registry.ts";
import { getConfig } from "../../config/index.ts";
import type { SkillResolver } from "./skill-resolver.ts";
import type { SuspendRef } from "./tools/index.ts";

export class PiToolFactory {
  /** Map<conversationId, HarnessContext> */
  readonly harnessContexts = new Map<number, HarnessContext>();
  /** Map<conversationId, CommonToolContext> */
  readonly commonCtxRefs = new Map<number, CommonToolContext>();

  constructor(
    private readonly config: PiEngineConfig,
    private readonly onTaskUpdated: OnTaskUpdated,
    private readonly onCancel: (executionId: number) => void,
  ) {}

  getOrCreateHarnessContext(
    conversationId: number,
    worktreePath: string,
    signal: AbortSignal = new AbortController().signal,
  ): HarnessContext {
    let ctx = this.harnessContexts.get(conversationId);
    if (!ctx) {
      ctx = {
        undoStack: new UndoStack(this.config.harness?.undo_stack_size),
        worktreePath,
        loopDetector: new ToolLoopDetector(),
        signal,
      };
      this.harnessContexts.set(conversationId, ctx);
    } else {
      ctx.worktreePath = worktreePath;
      ctx.signal = signal;
    }
    return ctx;
  }

  getOrCreateCommonContext(
    conversationId: number,
    workingDirectory: string | undefined,
    taskId: number | null | undefined,
    boardId: number | null | undefined,
    boardTools: ExecutionParams["boardTools"],
    onTransition: ExecutionParams["onTransition"],
    onHumanTurn: ExecutionParams["onHumanTurn"],
    workspaceKey?: string,
  ): CommonToolContext {
    const existing = this.commonCtxRefs.get(conversationId);
    if (existing) {
      existing.runtime.worktreePath = workingDirectory;
      existing.runtime.lspManager =
        taskLspRegistry.getManager(taskId ?? 0, getConfig().workspace.lsp?.servers ?? [], workingDirectory ?? "") ?? undefined;
      existing.workflow.onTransition = onTransition ?? (() => {});
      existing.workflow.onHumanTurn = onHumanTurn ?? (() => {});
      return existing;
    }
    const ctx: CommonToolContext = {
      workspaceKey: workspaceKey!,
      task: { id: taskId ?? null, boardId: boardId ?? null, conversationId },
      repos: {
        todos: new TodoRepository(),
        decisions: new DecisionRepository(),
        notes: new NoteRepository(),
        boardTools: boardTools!,
      },
      workflow: {
        onTransition: onTransition ?? (() => {}),
        onHumanTurn: onHumanTurn ?? (() => {}),
        onCancel: (id) => this.onCancel(id),
        onTaskUpdated: (task) => this.onTaskUpdated(task),
      },
      runtime: {
        worktreePath: workingDirectory,
        lspManager:
          taskLspRegistry.getManager(taskId ?? 0, getConfig().workspace.lsp?.servers ?? [], workingDirectory ?? "") ?? undefined,
      },
    };
    this.commonCtxRefs.set(conversationId, ctx);
    return ctx;
  }

  buildTools(
    conversationId: number,
    worktreePath: string,
    workingDirectory: string | undefined,
    taskId: number | null | undefined,
    boardId: number | null | undefined,
    boardTools: ExecutionParams["boardTools"],
    onTransition: ExecutionParams["onTransition"],
    onHumanTurn: ExecutionParams["onHumanTurn"],
    workspaceKey: string | undefined,
    skillResolver: SkillResolver,
    suspendRef: SuspendRef,
    signal?: AbortSignal,
    /** Child-spawning dependencies for delegate and web_search tools. */
    childSpawn?: ChildSpawnOptions,
  ): ReturnType<typeof buildAllTools> {
    const harnessCtx = this.getOrCreateHarnessContext(conversationId, worktreePath, signal);
    const commonCtx = this.getOrCreateCommonContext(
      conversationId,
      workingDirectory,
      taskId,
      boardId,
      boardTools,
      onTransition,
      onHumanTurn,
      workspaceKey,
    );

    return buildAllTools({
      harnessCtx,
      commonCtx,
      skillResolver,
      suspendRef,
      childSpawn,
    });
  }

  clear(conversationId?: number): void {
    if (conversationId !== undefined) {
      this.harnessContexts.delete(conversationId);
      this.commonCtxRefs.delete(conversationId);
    } else {
      this.harnessContexts.clear();
      this.commonCtxRefs.clear();
    }
  }
}
