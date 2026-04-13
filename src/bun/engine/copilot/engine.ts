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

import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineModelInfo, EngineResumeInput } from "../types.ts";
import type { OnTaskUpdated, OnNewMessage } from "../../workflow/engine.ts";
import type { CopilotSdkAdapter, CopilotSdkSession } from "./session";
import { copilotSessionIdForTask, createDefaultCopilotSdkAdapter } from "./session";
import { translateCopilotStream } from "./events";
import { buildCopilotTools } from "./tools";
import { resolvePrompt } from "../dialects/copilot-prompt-resolver.ts";

export class CopilotEngine implements ExecutionEngine {
  private readonly defaultModel: string | undefined;
  private readonly sdkAdapter: CopilotSdkAdapter;

  /** Active sessions keyed by executionId. */
  private readonly sessions = new Map<number, CopilotSdkSession>();
  private readonly pendingResumes = new Map<number, {
    resolve: (input: EngineResumeInput) => void;
    reject: (error: Error) => void;
  }>();

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

  async resume(executionId: number, input: EngineResumeInput): Promise<void> {
    const pending = this.pendingResumes.get(executionId);
    if (!pending) {
      throw new Error(`Execution ${executionId} is not waiting for resume input`);
    }
    this.pendingResumes.delete(executionId);
    pending.resolve(input);
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

    // Signal for interview_me interception: when the model calls interview_me,
    // store the payload and abort the session so the engine can emit the event.
    let pendingInterviewPayload: string | null = null;
    const interviewAbortController = new AbortController();

    const tools = buildCopilotTools(toolContext, (payload: string) => {
      pendingInterviewPayload = payload;
      interviewAbortController.abort();
    });

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
      streaming: true,
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
        // Abort the session explicitly — cancel() may have run before sessions.set()
        // and therefore couldn't abort it. The finally block handles disconnect.
        await this.sdkAdapter.abortSession(session).catch(() => { });
        return;
      }

      let resolvedInitialPrompt: string;
      try {
        resolvedInitialPrompt = await resolvePrompt(prompt, workingDirectory ?? "");
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        yield { type: "error", message: msg, fatal: true };
        return;
      }
      let nextPrompt: string | null = resolvedInitialPrompt;

      while (nextPrompt != null) {
        // Fire the prompt; pass the promise into translateCopilotStream so a rejection
        // (e.g. CLI crash) is surfaced as a fatal error rather than silently hanging.
        // Combine the external abort signal with the interview_me internal abort.
        const combinedController = new AbortController();
        params.signal?.addEventListener("abort", () => combinedController.abort(), { once: true });
        interviewAbortController.signal.addEventListener("abort", () => {
          this.sdkAdapter.abortSession(session!).catch(() => { });
          combinedController.abort();
        }, { once: true });

        const sendPromise = session.send({ prompt: nextPrompt });
        const onWatchdogFire = () => this.sdkAdapter.pingClient(sdkSessionId);
        let paused = false;
        let terminal = false;

        for await (const event of translateCopilotStream(session, combinedController.signal, sendPromise, onWatchdogFire)) {
          yield event;

          if (event.type === "ask_user" || event.type === "shell_approval") {
            paused = true;
            break;
          }

          if (
            event.type === "done" ||
            (event.type === "error" && event.fatal)
          ) {
            terminal = true;
            break;
          }
        }

        if (pendingInterviewPayload !== null) {
          yield { type: "interview_me", payload: pendingInterviewPayload };
          return;
        }

        if (params.signal?.aborted || terminal) {
          return;
        }

        if (!paused) {
          return;
        }

        const resumeInput = await this.waitForResume(executionId, params.signal);
        nextPrompt = this.mapResumeInputToPrompt(resumeInput);
      }
    } catch (err) {
      if (
        params.signal?.aborted ||
        (err instanceof Error && (
          err.message.includes("cancelled") ||
          err.message.includes("aborted while waiting for input")
        ))
      ) {
        return;
      }
      yield {
        type: "error",
        message: err instanceof Error ? err.message : String(err),
        fatal: true,
      };
    } finally {
      unsubStatus();
      const pending = this.pendingResumes.get(executionId);
      if (pending) {
        this.pendingResumes.delete(executionId);
        pending.reject(new Error(`Execution ${executionId} was closed before resuming`));
      }
      this.sessions.delete(executionId);
      if (session) {
        await this.sdkAdapter.disconnectSession(session).catch(() => { });
      }
      // Release the dedicated CLI process for this session now that the execution
      // is complete. Avoids orphaned CLI processes piling up between runs.
      await this.sdkAdapter.releaseClient(sdkSessionId).catch(() => { });
    }
  }

  cancel(executionId: number): void {
    const pending = this.pendingResumes.get(executionId);
    if (pending) {
      this.pendingResumes.delete(executionId);
      pending.reject(new Error(`Execution ${executionId} cancelled`));
    }
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

  private waitForResume(executionId: number, signal?: AbortSignal): Promise<EngineResumeInput> {
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
        resolve: (input) => {
          cleanup();
          resolve(input);
        },
        reject: (error) => {
          cleanup();
          reject(error);
        },
      });
    });
  }

  private mapResumeInputToPrompt(input: EngineResumeInput): string {
    switch (input.type) {
      case "ask_user":
        return input.content;
      case "shell_approval":
        return input.decision === "deny"
          ? "The requested shell command was denied by the user. Adjust your plan and continue without it."
          : input.decision === "approve_all"
            ? "The requested shell command was approved for this and similar commands. Continue."
            : "The requested shell command was approved once. Continue.";
    }
  }
}
