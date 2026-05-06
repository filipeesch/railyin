import type {
  ExecutionEngine,
  ExecutionParams,
  EngineEvent,
  EngineModelInfo,
  EngineResumeInput,
  CommandInfo,
  OnTaskUpdated,
  OnNewMessage,
  CommonToolContext,
} from "../types.ts";
import type { PiEngineConfig } from "../../config/index.ts";
import { Agent } from "@mariozechner/pi-agent-core";
import { streamSimple } from "@mariozechner/pi-ai";
import type { Model } from "@mariozechner/pi-ai";
import { TodoRepository } from "../../db/todos.ts";
import { DecisionRepository } from "../../db/repositories/decision-repository.ts";
import { ContentHashCache } from "./harness/hash-cache.ts";
import { UndoStack } from "./harness/undo-stack.ts";
import type { HarnessContext } from "./harness/context.ts";
import { buildAllTools } from "./tools/index.ts";
import { translateEvent } from "./event-translator.ts";

/** Default context window used when the config doesn't specify one. */
const DEFAULT_CONTEXT_WINDOW = 32_768;
const DEFAULT_MAX_TOKENS = 8_192;

export class PiEngine implements ExecutionEngine {
  private readonly config: PiEngineConfig;
  private readonly _onTaskUpdated: OnTaskUpdated;
  /** Map<conversationId, Agent> — one Pi Agent per conversation. */
  private readonly sessions = new Map<number, Agent>();
  private readonly pendingResumes = new Map<
    number,
    { resolve: (input: EngineResumeInput) => void; reject: (error: Error) => void }
  >();

  constructor(
    config: PiEngineConfig,
    onTaskUpdated: OnTaskUpdated,
    _onNewMessage: OnNewMessage,
  ) {
    this.config = config;
    this._onTaskUpdated = onTaskUpdated;
  }

  // ─── ExecutionEngine interface ──────────────────────────────────────────────

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
      model: modelOverride,
      prompt,
      signal,
      systemInstructions,
      taskContext,
      onRawModelMessage,
      onTransition,
      onHumanTurn,
      boardTools,
    } = params;

    // Build task context prefix for the system prompt
    const taskBlock = taskContext
      ? [
          `## Task`,
          `**Title:** ${taskContext.title}`,
          ...(taskContext.description ? [`**Description:** ${taskContext.description}`] : []),
        ].join("\n")
      : undefined;
    const enrichedSystem = [taskBlock, systemInstructions].filter(Boolean).join("\n\n") || undefined;

    // Build harness context (per-conversation, lazily)
    const harnessCtx = this.getOrCreateHarnessContext(conversationId, workingDirectory ?? process.cwd());

    const commonCtx: CommonToolContext = {
      task: { id: taskId, boardId: boardId ?? null, conversationId },
      repos: {
        todos: new TodoRepository(),
        decisions: new DecisionRepository(),
        boardTools: boardTools!,
      },
      workflow: {
        onTransition: onTransition ?? (() => {}),
        onHumanTurn: onHumanTurn ?? (() => {}),
        onCancel: (id) => this.cancel(id),
        onTaskUpdated: (task) => this._onTaskUpdated(task),
      },
      runtime: { worktreePath: workingDirectory },
    };

    const tools = buildAllTools({ harnessCtx, commonCtx });
    const piModel = this.buildModel(modelOverride);
    const agent = this.getOrCreateAgent(conversationId, piModel, tools, enrichedSystem);

    const events: EngineEvent[] = [];
    let agentError: Error | undefined;

    agent.subscribe((event) => {
      if (onRawModelMessage) {
        onRawModelMessage({
          engine: "pi",
          sessionId: String(conversationId),
          direction: "inbound",
          eventType: event.type,
          payload: event as unknown as Record<string, unknown>,
        });
      }
      for (const engineEvent of translateEvent(event)) {
        events.push(engineEvent);
      }
    });

    const promptPromise = agent.prompt(prompt).catch((err: unknown) => {
      agentError = err instanceof Error ? err : new Error(String(err));
    });

    // Drain events as they arrive, respecting abort
    try {
      while (true) {
        if (signal?.aborted) break;

        if (events.length > 0) {
          yield* events.splice(0);
          continue;
        }

        // Check if agent is done
        const isIdle = await Promise.race([
          agent.waitForIdle().then(() => true),
          new Promise<boolean>((res) => setTimeout(() => res(false), 10)),
        ]);

        if (events.length > 0) {
          yield* events.splice(0);
        }

        if (isIdle) break;
      }
    } finally {
      await promptPromise;
      this.pendingResumes.delete(executionId);
    }

    // Drain any remaining events
    if (events.length > 0) yield* events;

    if (agentError) {
      yield { type: "error", message: agentError.message, fatal: false };
      return;
    }

    yield { type: "done" };
  }

  async resume(executionId: number, input: EngineResumeInput): Promise<void> {
    const pending = this.pendingResumes.get(executionId);
    if (!pending) throw new Error(`Execution ${executionId} is not waiting for resume input`);
    this.pendingResumes.delete(executionId);
    pending.resolve(input);
  }

  cancel(executionId: number): void {
    const pending = this.pendingResumes.get(executionId);
    if (pending) {
      this.pendingResumes.delete(executionId);
      pending.reject(new Error(`Execution ${executionId} cancelled`));
    }
    // Abort the agent for this execution's conversation if we can find it.
    // We don't track executionId→conversationId here, so we abort all idle agents.
    for (const agent of this.sessions.values()) {
      try { agent.abort(); } catch { /* ignore */ }
    }
  }

  async listModels(): Promise<EngineModelInfo[]> {
    const providers = this.config.providers ?? {};
    if (Object.keys(providers).length === 0) {
      // No providers configured — surface the static model from config (if any)
      const model = this.config.model ?? "local/default";
      return [{ qualifiedId: model, displayName: model }];
    }

    const results: EngineModelInfo[] = [];
    for (const [providerId, providerCfg] of Object.entries(providers)) {
      const baseUrl = providerCfg.base_url.replace(/\/$/, "");
      try {
        const res = await fetch(`${baseUrl}/models`, {
          headers: providerCfg.api_key ? { Authorization: `Bearer ${providerCfg.api_key}` } : {},
          signal: AbortSignal.timeout(5_000),
        });
        if (!res.ok) continue;
        const json = (await res.json()) as { data?: { id: string }[] };
        for (const m of json.data ?? []) {
          // Skip embedding models — they can't be used for text generation
          if (m.id.includes("embed")) continue;
          const qualifiedId = `${providerId}/${m.id}`;
          results.push({ qualifiedId, displayName: m.id });
        }
      } catch {
        // Provider unreachable — skip silently
      }
    }

    // Fall back to static model if no provider returned anything
    if (results.length === 0) {
      const model = this.config.model ?? "local/default";
      return [{ qualifiedId: model, displayName: model }];
    }

    return results;
  }

  async listCommands(_taskId: number): Promise<CommandInfo[]> {
    return [];
  }

  async compact(_taskId: number | null, conversationId: number, _workingDirectory: string): Promise<void> {
    // Pi doesn't have an explicit compaction API. Resetting the window flags
    // is the closest analog — it allows the cache to re-serve content on next read.
    const ctx = this.harnessContexts.get(conversationId);
    if (ctx) ctx.hashCache.resetWindowFlags();
  }

  async shutdown(): Promise<void> {
    for (const agent of this.sessions.values()) {
      try { agent.abort(); } catch { /* ignore */ }
    }
    this.sessions.clear();
    this.harnessContexts.clear();
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /** Map<conversationId, HarnessContext> */
  private readonly harnessContexts = new Map<number, HarnessContext>();

  private getOrCreateHarnessContext(conversationId: number, worktreePath: string): HarnessContext {
    let ctx = this.harnessContexts.get(conversationId);
    if (!ctx) {
      ctx = {
        hashCache: new ContentHashCache(),
        undoStack: new UndoStack(this.config.harness?.undo_stack_size),
        worktreePath,
      };
      this.harnessContexts.set(conversationId, ctx);
    }
    return ctx;
  }

  private getOrCreateAgent(
    conversationId: number,
    model: Model<"openai-completions">,
    tools: ReturnType<typeof buildAllTools>,
    systemPrompt?: string,
  ): Agent {
    const existing = this.sessions.get(conversationId);
    if (existing) {
      // Update tools in case conversation state changed
      existing.state.tools = tools as any;
      return existing;
    }

    const agent = new Agent({
      initialState: {
        model: model as any,
        tools: tools as any,
        systemPrompt,
      },
      streamFn: streamSimple as any,
    });

    this.sessions.set(conversationId, agent);
    return agent;
  }

  private buildModel(modelOverride?: string): Model<"openai-completions"> {
    const modelStr = modelOverride ?? this.config.model ?? "default";
    const [providerName, ...rest] = modelStr.split("/");
    const modelId = rest.join("/") || providerName;

    const providerConfig = this.config.providers?.[providerName];
    const baseUrl = providerConfig?.base_url ?? "http://localhost:1234/v1";

    return {
      id: modelId,
      name: modelStr,
      api: "openai-completions",
      provider: providerName,
      baseUrl,
      reasoning: false,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      maxTokens: DEFAULT_MAX_TOKENS,
    } as unknown as Model<"openai-completions">;
  }
}
