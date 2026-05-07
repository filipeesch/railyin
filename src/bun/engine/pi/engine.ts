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
import { QualifiedModelId } from "../qualified-model-id.ts";
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
import { createHash } from "crypto";
import { mkdir, readFile, writeFile } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

function piSessionPathForConversation(conversationId: number): string {
  const hash = createHash("sha1").update(`railyin-pi-conversation-${conversationId}`).digest("hex");
  return join(homedir(), ".railyin", "pi-sessions", `${hash}.json`);
}

async function loadSessionMessages(sessionPath: string): Promise<unknown[] | null> {
  try {
    const data = await readFile(sessionPath, "utf8");
    const parsed = JSON.parse(data);
    if (Array.isArray(parsed)) return parsed;
  } catch {
    // file not found or corrupt — fresh session
  }
  return null;
}

async function saveSessionMessages(sessionPath: string, messages: unknown[]): Promise<void> {
  try {
    await mkdir(join(homedir(), ".railyin", "pi-sessions"), { recursive: true });
    await writeFile(sessionPath, JSON.stringify(messages), "utf8");
  } catch {
    // non-fatal — next restart will just start fresh
  }
}

/** Default context window used when the config doesn't specify one. */
const DEFAULT_CONTEXT_WINDOW = 32_768;
const DEFAULT_MAX_TOKENS = 8_192;

export class PiEngine implements ExecutionEngine {
  private readonly engineId: string;
  private readonly config: PiEngineConfig;
  private readonly _onTaskUpdated: OnTaskUpdated;
  /** Map<conversationId, Agent> — one Pi Agent per conversation. */
  private readonly sessions = new Map<number, Agent>();
  private readonly pendingResumes = new Map<
    number,
    { resolve: (input: EngineResumeInput) => void; reject: (error: Error) => void }
  >();

  constructor(
    engineId: string,
    config: PiEngineConfig,
    onTaskUpdated: OnTaskUpdated,
    _onNewMessage: OnNewMessage,
  ) {
    this.engineId = engineId;
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
    const agent = await this.getOrCreateAgent(conversationId, piModel, tools, enrichedSystem);

    const events: EngineEvent[] = [];
    let agentError: Error | undefined;

    const unsubscribe = agent.subscribe((event) => {
      if (onRawModelMessage) {
        onRawModelMessage({
          engine: "pi",
          sessionId: String(conversationId),
          direction: "inbound",
          eventType: event.type,
          payload: event as unknown as Record<string, unknown>,
        });
      }
      for (const engineEvent of translateEvent(event, workingDirectory)) {
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
      unsubscribe();
      this.pendingResumes.delete(executionId);
    }

    // Drain any remaining events
    if (events.length > 0) yield* events;

    if (agentError) {
      // Pi pushes a { stopReason: "error" } message into agent._state.messages on failure.
      // If we reuse this agent on the next turn, that poison message is included in the
      // context snapshot sent to the LLM — causing the same error to repeat forever.
      // Fix: strip trailing error messages so the next turn starts from valid state.
      // Rollback to the last complete turn: strip the error assistant message AND
      // any trailing user/tool messages that have no valid assistant reply, so the
      // next turn doesn't send two consecutive user messages to the LLM.
      const agent = this.sessions.get(conversationId);
      if (agent) {
        const msgs = agent.state.messages as any[];
        // Walk backwards past the error message and any orphaned non-assistant messages
        let end = msgs.length;
        while (end > 0) {
          const last = msgs[end - 1];
          if (last.role === "assistant" && last.stopReason !== "error") break;
          end--;
        }
        agent.state.messages = msgs.slice(0, end) as any;
      }

      // Provide a clear hint for the known LM Studio MLX backend bug
      const isTreeReduceBug = agentError.message.includes("tree_reduce");
      const message = isTreeReduceBug
        ? `LM Studio MLX backend error: '${agentError.message}'. ` +
          "This is a known bug in MLX models with conversation history. " +
          "Switch to a GGUF model (llama.cpp backend) in LM Studio to fix this."
        : agentError.message;
      yield { type: "error", message, fatal: false };
      return;
    }

    // Persist session messages to disk so they survive server restarts
    const sessionPath = piSessionPathForConversation(conversationId);
    await saveSessionMessages(sessionPath, agent.state.messages as unknown[]);

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
          const qualifiedId = `${this.engineId}/${providerId}/${m.id}`;
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
    } else {
      // Always update worktreePath — it may have changed (e.g. worktree became ready since first call)
      ctx.worktreePath = worktreePath;
    }
    return ctx;
  }

  private async getOrCreateAgent(
    conversationId: number,
    model: Model<"openai-completions">,
    tools: ReturnType<typeof buildAllTools>,
    systemPrompt?: string,
  ): Promise<Agent> {
    const existing = this.sessions.get(conversationId);
    if (existing) {
      existing.state.model = model as any;
      existing.state.tools = tools as any;
      existing.state.thinkingLevel = "auto";
      if (systemPrompt !== undefined) existing.state.systemPrompt = systemPrompt;
      return existing;
    }

    // Try to restore from disk (session survives server restarts)
    const sessionPath = piSessionPathForConversation(conversationId);
    const savedMessages = await loadSessionMessages(sessionPath);

    const agent = new Agent({
      initialState: {
        model: model as any,
        tools: tools as any,
        systemPrompt,
        thinkingLevel: "auto",
        messages: (savedMessages ?? []) as any,
      },
      streamFn: streamSimple as any,
      getApiKey: (provider) => this.config.providers?.[provider]?.api_key || "no-key",
    });

    this.sessions.set(conversationId, agent);
    return agent;
  }

  private buildModel(modelOverride?: string): Model<"openai-completions"> {
    const modelStr = modelOverride ?? this.config.model ?? "default";

    // Expects 3-part format: engineId/providerName/modelId (as returned by listModels).
    // nativeModelId() strips the engine prefix, giving providerName/modelId.
    const qmid = QualifiedModelId.tryParse(modelStr);
    const nativeId = qmid?.nativeModelId() ?? modelStr;
    const slash = nativeId.indexOf("/");
    const providerName = slash !== -1 ? nativeId.slice(0, slash) : undefined;
    const modelId = slash !== -1 ? nativeId.slice(slash + 1) : nativeId;

    const providerConfig = providerName ? this.config.providers?.[providerName] : undefined;
    const baseUrl = providerConfig?.base_url ?? "http://localhost:1234/v1";

    return {
      id: modelId,
      name: nativeId,
      api: "openai-completions",
      provider: providerName ?? "default",
      baseUrl,
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: DEFAULT_CONTEXT_WINDOW,
      maxTokens: DEFAULT_MAX_TOKENS,
    } as unknown as Model<"openai-completions">;
  }
}
