/**
 * CopilotEngine — implements ExecutionEngine using the GitHub Copilot SDK.
 *
 * Uses @github/copilot-sdk to proxy agent execution through Copilot CLI.
 * Task management tools (tasks_read + tasks_write groups) are registered
 * as custom tools via the SDK's Tool interface from engine/copilot/tools.ts.
 *
 * Auth: handled automatically by the SDK (env vars → CLI login → gh auth).
 * Compaction: handled by Copilot's infinite sessions feature.
 */

import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineModelInfo } from "../types.ts";
import type { OnTaskUpdated, OnNewMessage } from "../../workflow/engine.ts";
import type { CopilotSdkAdapter, CopilotSdkSession } from "./session";
import { copilotSessionIdForTask, createDefaultCopilotSdkAdapter } from "./session";
import { translateCopilotStream } from "./events";
import { buildCopilotTools } from "./tools";

export class CopilotEngine implements ExecutionEngine {
  private readonly defaultModel: string | undefined;
  private readonly sdkAdapter: CopilotSdkAdapter;

  /** Active sessions keyed by executionId. */
  private readonly sessions = new Map<number, CopilotSdkSession>();

  constructor(
    defaultModel: string | undefined,
    _onTaskUpdated: OnTaskUpdated,
    _onNewMessage: OnNewMessage,
    sdkAdapter: CopilotSdkAdapter = createDefaultCopilotSdkAdapter(),
  ) {
    this.defaultModel = defaultModel;
    this.sdkAdapter = sdkAdapter;
  }

  execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
    return this._run(params);
  }

  private async *_run(params: ExecutionParams): AsyncGenerator<EngineEvent> {
    const { executionId, taskId, boardId, prompt, systemInstructions, workingDirectory, model } = params;

    // Resolve model: prefer execution-specific model, fall back to engine default.
    // Strip the "copilot/" namespace prefix — it's our internal qualifier, the SDK
    // expects the bare model name (e.g. "claude-sonnet-4.6", not "copilot/claude-sonnet-4.6").
    const rawModel = model || this.defaultModel;
    const resolvedModel = rawModel?.startsWith("copilot/") ? rawModel.slice("copilot/".length) : rawModel;

    // Build tool context for common task-management tools
    const toolContext = {
      taskId,
      boardId: boardId ?? 0,
      onTransition: (_tId: number, _state: string) => {
        // Transitions are not directly triggered from Copilot turn; log only
      },
      onHumanTurn: (_tId: number, _msg: string) => {
        // Human turns not triggered from within Copilot execution
      },
      onCancel: (_execId: number) => {
        this.cancel(_execId);
      },
    };

    const tools = buildCopilotTools(toolContext);

    // Build system message — append stage_instructions to SDK's managed prompt
    const systemMessage = systemInstructions
      ? { mode: "append" as const, content: systemInstructions }
      : undefined;

    const sessionConfig = {
      ...(resolvedModel ? { model: resolvedModel } : {}),
      tools,
      ...(systemMessage ? { systemMessage } : {}),
      onPermissionRequest: (_req: unknown, _inv: unknown) => {
        // Approve all — the Copilot agent operates inside our controlled environment
        return { kind: "approved" as const };
      },
      workingDirectory,
    };

    // Deterministic session ID — always derived from taskId so context survives
    // process restarts without needing any DB or in-memory state.
    const sdkSessionId = copilotSessionIdForTask(taskId);

    let session: CopilotSdkSession | undefined;
    try {
      try {
        session = await this.sdkAdapter.resumeSession(sdkSessionId, sessionConfig);
      } catch {
        // Session data doesn't exist on disk yet (first run) or was deleted.
        // Create with the same deterministic ID so future runs can always resume it.
        session = await this.sdkAdapter.createSession({ sessionId: sdkSessionId, ...sessionConfig });
      }

      this.sessions.set(executionId, session);

      // Bail early if the execution was cancelled while we were creating the session
      // (user clicked stop before session creation completed).
      if (params.signal?.aborted) {
        return;
      }

      // Fire the prompt; pass the promise into translateCopilotStream so a rejection
      // (e.g. CLI crash) is surfaced as a fatal error rather than silently hanging.
      const sendPromise = session.send({ prompt });
      yield* translateCopilotStream(session, params.signal, sendPromise);
    } catch (err) {
      yield {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
        fatal: true,
      };
    } finally {
      this.sessions.delete(executionId);
      if (session) {
        await this.sdkAdapter.disconnectSession(session).catch(() => { });
      }
    }
  }

  cancel(executionId: number): void {
    const session = this.sessions.get(executionId);
    if (session) {
      // Abort the in-progress turn first so the model stops cleanly and the
      // session state on disk stays consistent for future resumption.
      this.sdkAdapter.abortSession(session)
        .catch(() => { })
        .finally(() => this.sdkAdapter.disconnectSession(session).catch(() => { }));
    }
    this.sessions.delete(executionId);
  }

  async listModels(): Promise<EngineModelInfo[]> {
    const sdkModels = await this.sdkAdapter.listModels();
    return sdkModels.map((m) => ({
      qualifiedId: `copilot/${m.id}`,
      displayName: m.name ?? m.id,
      contextWindow: m.capabilities.limits.max_context_window_tokens,
      supportsThinking: m.capabilities.supports.reasoningEffort,
    }));
  }
}
