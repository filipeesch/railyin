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
import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineModelInfo, CommandInfo, OnTaskUpdated, OnNewMessage, CommonToolContext } from "../types.ts";
import { createDefaultCursorSdkAdapter, type CursorSdkAdapter } from "./adapter.ts";
import { buildCursorTools } from "./tools.ts";
import { taskLspRegistry } from "../../lsp/task-registry.ts";
import { getConfig } from "../../config/index.ts";
import { TodoRepository } from "../../db/todos.ts";
import { DecisionRepository } from "../../db/repositories/decision-repository.ts";
import { NoteRepository } from "../../db/repositories/note-repository.ts";
import { getDefaultWorkspaceKey } from "../../workspace-context.ts";
import type { Task } from "../../../shared/rpc-types.ts";

export { createDefaultCursorSdkAdapter };

interface ExecutionState {
  abort: AbortController;
}

export class CursorEngine implements ExecutionEngine {
  private readonly adapter: CursorSdkAdapter;
  private readonly onTaskUpdated: OnTaskUpdated;
  private readonly executions = new Map<number, ExecutionState>();

  constructor(
    onTaskUpdated: OnTaskUpdated,
    _onNewMessage: OnNewMessage,
    adapter: CursorSdkAdapter = createDefaultCursorSdkAdapter(),
  ) {
    this.onTaskUpdated = onTaskUpdated;
    this.adapter = adapter;
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

  async listCommands(_taskId: number): Promise<CommandInfo[]> {
    return await this.adapter.listCommands(process.cwd());
  }

  async shutdown(_options?: unknown): Promise<void> {
    await this.adapter.shutdownAll?.();
  }

  private async *_run(params: ExecutionParams): AsyncGenerator<EngineEvent> {
    const { executionId, taskId, boardId, workingDirectory, model, prompt, signal, systemInstructions, taskContext, boardTools } = params;
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
      workspaceKey: getDefaultWorkspaceKey(),
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
    // The Cursor SDK 1.0.18 has broken built-in tools (Shell/Grep/Glob fail
    // over the gRPC transport on non-trivial workloads). Redirect the agent
    // to Railyn-native equivalents registered as custom tools.
    const bypassNotice = [
      "## Tool routing (IMPORTANT)",
      "The built-in `Shell`, `Grep`, and `Glob` tools are unreliable in this environment. ALWAYS prefer these Railyn-native equivalents:",
      "- Shell → `railyin_shell`",
      "- Grep → `railyin_grep`",
      "- Glob → `railyin_glob`",
      "- Read (fallback) → `railyin_read`",
      "Use the built-in `Read` only for single, known files; otherwise use the Railyn tools.",
    ].join("\n");
    const prefix = [systemBlock, taskBlock, bypassNotice].filter(Boolean).join("\n\n");
    const composedPrompt = prefix ? `${prefix}\n\n---\n\n${prompt}` : prompt;

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
