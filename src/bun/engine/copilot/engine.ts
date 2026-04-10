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
    // cliPath is only used when constructing the default adapter above;
    // when a custom sdkAdapter is injected (tests) this parameter is unused.
  ) {
    this.defaultModel = defaultModel;
    this.sdkAdapter = sdkAdapter;
  }

  execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
    return this._run(params);
  }

  private async *_run(params: ExecutionParams): AsyncGenerator<EngineEvent> {
    const { executionId, taskId, boardId, prompt, systemInstructions, workingDirectory, model } = params;

    // Collect status messages from the adapter (download/setup progress)
    // so we can yield them as engine events for the UI.
    const pendingStatus: string[] = [];
    const unsubStatus = this.sdkAdapter.onStatus((msg) => pendingStatus.push(msg));

    // Helper: yield any buffered status events.
    const flushStatus = function* (): Generator<EngineEvent> {
      while (pendingStatus.length > 0) {
        yield { type: "status", message: pendingStatus.shift()! };
      }
    };

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
        yield* flushStatus();
        session = await this.sdkAdapter.resumeSession(sdkSessionId, sessionConfig);
        yield* flushStatus();
      } catch {
        // Session data doesn't exist on disk yet (first run) or was deleted.
        // Create with the same deterministic ID so future runs can always resume it.
        yield* flushStatus();
        session = await this.sdkAdapter.createSession({ sessionId: sdkSessionId, ...sessionConfig });
        yield* flushStatus();
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
      unsubStatus();
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
    let sdkModels;
    try {
      sdkModels = await this.sdkAdapter.listModels();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[copilot] listModels failed:", err instanceof Error ? err.stack ?? err.message : err);
      throw new Error(
        `Copilot CLI failed to start: ${msg}\n\nRailyn automatically downloads the Copilot CLI binary on first use.\nPlease check your internet connection and try again.\n\nIf the problem persists, check the logs at ~/.railyn/logs/bun.log`,
        { cause: err },
      );
    }
    return sdkModels.map((m) => ({
      qualifiedId: `copilot/${m.id}`,
      displayName: m.name ?? m.id,
      contextWindow: m.capabilities.limits.max_context_window_tokens,
      supportsThinking: m.capabilities.supports.reasoningEffort,
    }));
  }
}
