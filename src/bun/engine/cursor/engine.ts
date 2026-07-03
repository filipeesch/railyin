/**
 * Cursor Engine — implements ExecutionEngine using the Cursor SDK.
 *
 * Uses @cursor/sdk for agent execution. Railyn's task-orchestration tools
 * (decision_request, note, board tools, todos, LSP, MCP) are registered as
 * Cursor SDKCustomTool entries via engine/cursor/tools.ts. Cursor's built-in
 * tools (Read/Edit/Shell/Grep) remain enabled alongside — the SDK does not
 * expose a knob to disable them; the agent is steered via system instructions.
 *
 * Auth: handled via the api_key in engines.yaml or process.env.CURSOR_API_KEY.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { SlashCommandDialect } from "../dialects/slash-command-dialect.ts";
import { CursorDialect } from "../dialects/cursor-dialect.ts";
import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineModelInfo, CommandInfo, OnTaskUpdated, OnNewMessage, CommonToolContext } from "../types.ts";
import { createDefaultCursorSdkAdapter, type CursorSdkAdapter } from "./adapter.ts";
import { buildCursorTools } from "./tools.ts";
import { taskLspRegistry } from "../../lsp/task-registry.ts";
import { getConfig } from "../../config/index.ts";
import { TodoRepository } from "../../db/todos.ts";
import { DecisionRepository } from "../../db/repositories/decision-repository.ts";
import { NoteRepository } from "../../db/repositories/note-repository.ts";
import type { Task } from "../../../shared/rpc-types.ts";

export { createDefaultCursorSdkAdapter };

interface ExecutionState {
  abort: AbortController;
}

export class CursorEngine implements ExecutionEngine {
  private readonly adapter: CursorSdkAdapter;
  private readonly onTaskUpdated: OnTaskUpdated;
  private readonly dialect: SlashCommandDialect;
  private readonly executions = new Map<number, ExecutionState>();

  constructor(
    onTaskUpdated: OnTaskUpdated,
    _onNewMessage: OnNewMessage,
    adapter: CursorSdkAdapter = createDefaultCursorSdkAdapter(),
    dialect: SlashCommandDialect = new CursorDialect(),
  ) {
    this.onTaskUpdated = onTaskUpdated;
    this.adapter = adapter;
    this.dialect = dialect;
  }

  execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
    return this._run(params);
  }

  async resume(executionId: number, _input: unknown): Promise<void> {
    // The Cursor SDK has no in-turn resume path — decision_request / ask_user
    // end the run. Throwing here is the contract that tells human-turn-executor
    // to roll back the optimistic "running" state and start a fresh execution
    // (see human-turn-executor.ts catch block around line 79).
    throw new Error(`Execution ${executionId} is not waiting for resume input`);
  }

  cancel(executionId: number): void {
    const state = this.executions.get(executionId);
    if (state) {
      state.abort.abort();
      this.executions.delete(executionId);
    }
  }

  async listModels(): Promise<EngineModelInfo[]> {
    const models = await this.adapter.listModels(process.cwd());
    return models.map((m) => ({
      qualifiedId: `cursor/${m.value}`,
      displayName: m.displayName,
      description: m.description,
      supportsThinking: m.supportsThinking,
    }));
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

    const gitRow = db
      .query<{ worktree_path: string | null }, [number]>(
        "SELECT worktree_path FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);

    const worktreePath = gitRow?.worktree_path ?? process.cwd();

    let projectPath: string | undefined;
    if (taskRow) {
      const wsKey =
        db.query<{ workspace_key: string }, [number]>(
          "SELECT workspace_key FROM boards WHERE id = ?",
        ).get(taskRow.board_id)?.workspace_key ?? getDefaultWorkspaceKey();
      const project = getLoadedProjectByKey(wsKey, taskRow.project_key);
      if (project?.projectPath && project.projectPath !== worktreePath) {
        projectPath = project.projectPath;
      }
    }

    return this.dialect.listCommands(worktreePath, projectPath);
  }

  async shutdown(_options?: unknown): Promise<void> {
    await this.adapter.shutdownAll?.();
  }

  private async *_run(params: ExecutionParams): AsyncGenerator<EngineEvent> {
    const { executionId, taskId, boardId, workingDirectory, model, prompt, signal, systemInstructions, taskContext, boardTools, workspaceKey } = params;
    const sessionId = `cursor-${params.conversationId}`;

    // Strip the "cursor/" namespace prefix — the SDK expects the bare model id
    // (e.g. "claude-sonnet-4-6", not "cursor/claude-sonnet-4-6").
    const resolvedModel = model?.startsWith("cursor/") ? model.slice("cursor/".length) : model;

    // The Cursor SDK has no in-handler stop signal. When a suspend-loop tool
    // (e.g. decision_request) fires, we record the payload and abort the run
    // externally so the stream cuts before the model generates a next turn.
    let pendingDecisionPayload: string | null = null;
    const decisionAbort = new AbortController();
    const onSuspend = (payload: string) => {
      pendingDecisionPayload = payload;
      decisionAbort.abort();
    };

    // Merge the external cancel signal with the internal decision-abort signal
    // into a single signal handed to the adapter.
    const combinedAbort = new AbortController();
    const forward = () => combinedAbort.abort();
    if (signal) {
      if (signal.aborted) forward();
      else signal.addEventListener("abort", forward, { once: true });
    }
    decisionAbort.signal.addEventListener("abort", forward, { once: true });

    this.executions.set(executionId, { abort: combinedAbort });

    // Build tool context for Railyn common tools.
    const config = getConfig();
    const lspManager = taskLspRegistry.getManager(
      taskId ?? 0,
      config.workspace.lsp?.servers ?? [],
      workingDirectory,
    );
    const toolContext: CommonToolContext = {
      task: {
        id: taskId,
        boardId: boardId ?? null,
        conversationId: params.conversationId,
      },
      repos: {
        todos: new TodoRepository(),
        decisions: new DecisionRepository(),
        notes: new NoteRepository(),
        boardTools: boardTools!,
      },
      workflow: {
        onTransition: params.onTransition ?? (() => {}),
        onHumanTurn: params.onHumanTurn ?? (() => {}),
        onCancel: (execId: number) => this.cancel(execId),
        onTaskUpdated: (task: Task) => this.onTaskUpdated(task),
      },
      runtime: {
        lspManager: lspManager ?? undefined,
        worktreePath: workingDirectory,
      },
      workspaceKey: params.workspaceKey!,
    };

    const customTools = buildCursorTools(
      toolContext,
      params.mcpRegistry ?? null,
      params.enabledMcpTools ?? [],
      onSuspend,
    );

    // The Cursor SDK has no system-message slot — inline the task context and
    // stage instructions as a prefix to the user prompt.
    const taskBlock = taskContext
      ? [`## Task`, `**Title:** ${taskContext.title}`, ...(taskContext.description ? [`**Description:** ${taskContext.description}`] : [])].join("\n")
      : null;
    const systemBlock = systemInstructions ?? null;
    // Steer the agent toward Railyn-native equivalents over Cursor's built-in
    // Shell/Grep/Glob. The Railyn tools run in-process inside Bun, so their
    // output bypasses Cursor's transport entirely — safer for large results.
    const bypassNotice = [
      "## Tool routing (IMPORTANT)",
      "ALWAYS prefer these Railyn-native equivalents over the built-ins:",
      "- Shell → `railyin_shell`",
      "- Grep → `railyin_grep`",
      "- Glob → `railyin_glob`",
      "- Read (fallback) → `railyin_read`",
      "Use the built-in `Read` only for single, known files; otherwise use the Railyn tools.",
    ].join("\n");
    // Resolve slash-command references (e.g. /create-or-update-pr → XML-wrapped body)
    const resolvedPrompt = await this.dialect.resolvePrompt(prompt, workingDirectory);
    const effectivePrompt = resolvedPrompt.content;

    // Read skill SKILL.md files and prepend to system instructions
    const skillPaths = this.dialect.getSkillPaths(workingDirectory);
    const skillBlocks: string[] = [];
    for (const skillDir of skillPaths) {
      if (!existsSync(skillDir)) continue;
      const skillFiles = readdirSync(skillDir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => e.name);
      for (const name of skillFiles) {
        const skillMd = join(skillDir, name, "SKILL.md");
        if (existsSync(skillMd)) {
          try {
            const content = readFileSync(skillMd, "utf-8");
            skillBlocks.push(`## Skill: ${name}\n\n${content}`);
          } catch { /* skip unreadable */ }
        }
      }
    }
    const skillsBlock = skillBlocks.length > 0 ? skillBlocks.join("\n\n") : null;

    const prefix = [skillsBlock, systemBlock, taskBlock, bypassNotice].filter(Boolean).join("\n\n");
    const composedPrompt = prefix ? `${prefix}\n\n---\n\n${effectivePrompt}` : effectivePrompt;

    // Deterministic agent id derived from the conversation so the Cursor SDK
    // resumes the same agent across turns without any DB state. The worker
    // tries Agent.resume(agentId, ...) first and falls back to
    // Agent.create({ agentId, ... }) on the first turn (or after a resume
    // failure). Mirrors the Copilot session-id pattern.
    const agentId = cursorAgentIdForConversation(taskId ?? null, params.conversationId);

    const runConfig = {
      executionId,
      taskId: taskId || 0,
      prompt: composedPrompt,
      workingDirectory,
      model: resolvedModel,
      systemInstructions,
      taskContext,
      signal: combinedAbort.signal,
      sessionId,
      customTools,
      agentId,
      workspaceKey: params.workspaceKey!,
      onRawMessage: (message: unknown) => {
        params.onRawModelMessage?.({
          engine: "cursor",
          sessionId,
          direction: "inbound",
          eventType: (message as { type?: string })?.type ?? "unknown",
          payload: message as Record<string, unknown>,
        });
      },
    };

    try {
      if (combinedAbort.signal.aborted) return;
      for await (const event of this.adapter.run(runConfig)) {
        // Swallow the adapter's terminal "done" — we emit our own terminal
        // event (either decision_request or done) once the stream ends.
        if (event.type === "done") break;
        yield event;
      }

      if (pendingDecisionPayload !== null) {
        yield { type: "decision_request", payload: pendingDecisionPayload };
        return;
      }

      if (signal?.aborted) return;
      yield { type: "done" };
    } catch (err) {
      if (signal?.aborted || decisionAbort.signal.aborted) {
        if (pendingDecisionPayload !== null) {
          yield { type: "decision_request", payload: pendingDecisionPayload };
        }
        return;
      }
      yield { type: "error", message: err instanceof Error ? err.message : String(err), fatal: true };
    } finally {
      if (signal) signal.removeEventListener("abort", forward);
      this.executions.delete(executionId);
    }
  }
}

/**
 * Deterministic Cursor agent id for a conversation, as a UUIDv5.
 *
 * The id is computed (not stored) so the worker can always retry
 * Agent.resume(agentId) and fall back to Agent.create({ agentId }) on the
 * first turn. UUID format matches what the SDK auto-generates for local
 * agents, keeping the id opaque in any UI that surfaces it.
 *
 * Task-scoped conversations key on the task id so the agent survives even
 * if the conversation row is rebuilt. Detached chats key on the conversation
 * id.
 */
export function cursorAgentIdForConversation(
  taskId: number | null,
  conversationId: number,
): string {
  const name = taskId != null ? `task:${taskId}` : `conversation:${conversationId}`;
  return uuidv5(name, CURSOR_AGENT_NAMESPACE);
}

// Fixed namespace UUID for Railyin's Cursor agent ids. Generated once; do not
// change — every existing agent in a local store is keyed by the id derived
// from this namespace.
const CURSOR_AGENT_NAMESPACE = "a3f5e2d4-7b8c-4d9e-9f0a-1b2c3d4e5f60";

function uuidv5(name: string, namespace: string): string {
  const nsBytes = Buffer.from(namespace.replace(/-/g, ""), "hex");
  const hash = createHash("sha1").update(Buffer.concat([nsBytes, Buffer.from(name)])).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
