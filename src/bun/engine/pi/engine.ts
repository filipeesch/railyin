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
import type { SlashCommandDialect } from "../dialects/slash-command-dialect.ts";
import { NullDialect } from "../dialects/null-dialect.ts";
import { QualifiedModelId } from "../qualified-model-id.ts";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
  AuthStorage,
  createAgentSession,
  defineTool,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import type { Model } from "@earendil-works/pi-ai";
import { TodoRepository } from "../../db/todos.ts";
import { DecisionRepository } from "../../db/repositories/decision-repository.ts";
import { UndoStack } from "./harness/undo-stack.ts";
import type { HarnessContext } from "./harness/context.ts";
import { buildAllTools } from "./tools/index.ts";
import { translateEvent } from "./event-translator.ts";
import { getDb } from "../../db/index.ts";
import { appendMessage } from "../../conversation/messages.ts";
import { AsyncQueue } from "./async-queue.ts";
import { createHash } from "crypto";
import { mkdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

const PI_SESSIONS_DIR = join(homedir(), ".railyin", "pi-sessions");

function piSessionPathForConversation(conversationId: number): string {
  const hash = createHash("sha1").update(`railyin-pi-conversation-${conversationId}`).digest("hex");
  return join(PI_SESSIONS_DIR, `${hash}.jsonl`);
}

/** Default context window used when the config doesn't specify one. */
const DEFAULT_CONTEXT_WINDOW = 128_000;
const DEFAULT_MAX_TOKENS = 8_192;

export class PiEngine implements ExecutionEngine {
  private readonly engineId: string;
  private readonly config: PiEngineConfig;
  private readonly _onTaskUpdated: OnTaskUpdated;
  private readonly dialect: SlashCommandDialect;
  /** Map<conversationId, AgentSession> — one Pi session per conversation. */
  private readonly sessions = new Map<number, AgentSession>();
  /** Map<conversationId, SuspendRef> — mutable ref updated at each execution start. */
  private readonly suspendRefs = new Map<number, { onSuspend?: (event: EngineEvent) => void }>();
  /** Map<executionId, conversationId> — lets cancel() find the right session. */
  private readonly executionToConversation = new Map<number, number>();
  private readonly pendingResumes = new Map<
    number,
    { resolve: (input: EngineResumeInput) => void; reject: (error: Error) => void }
  >();

  constructor(
    engineId: string,
    config: PiEngineConfig,
    onTaskUpdated: OnTaskUpdated,
    _onNewMessage: OnNewMessage,
    dialect: SlashCommandDialect = new NullDialect(),
  ) {
    this.engineId = engineId;
    this.config = config;
    this._onTaskUpdated = onTaskUpdated;
    this.dialect = dialect;
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
      contextWindowOverride,
    } = params;

    // Bail immediately if already cancelled before we even start.
    if (signal?.aborted) {
      yield { type: "done" } as EngineEvent;
      return;
    }

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

    const tools = buildAllTools({ harnessCtx, commonCtx, suspendRef: this.getOrCreateSuspendRef(conversationId) });
    const piModel = this.buildModel(modelOverride, contextWindowOverride);

    // Look up the project path before session creation so it can be used when
    // wiring dialect skill paths into the Pi resource loader.
    const projectPath = boardId != null && taskId != null
      ? await this.lookupProjectPath(taskId, boardId, workingDirectory ?? process.cwd())
      : undefined;

    const session = await this.getOrCreateSession(conversationId, piModel, tools, enrichedSystem, workingDirectory ?? process.cwd(), projectPath);

    this.executionToConversation.set(executionId, conversationId);

    // Use a buffered AsyncQueue as the push-to-pull bridge.
    // Unlike a single-callback approach, push() never loses a notification:
    // items buffer when nobody is waiting and are delivered immediately when consumed.
    // close() terminates the for-await instantly regardless of timing.
    const queue = new AsyncQueue<EngineEvent>();
    let agentError: Error | undefined;
    let suspendedForDecision = false;

    // Wire the suspend callback for this execution into the shared ref.
    // The tool closures captured `suspendRef` by reference, so they always read the latest value.
    const suspendRef = this.getOrCreateSuspendRef(conversationId);
    suspendRef.onSuspend = (event: EngineEvent) => {
      suspendedForDecision = true;
      queue.push(event);
      session.abort().catch(() => {});
    };

    // Abort: tell Pi to stop AND close the queue so the for-await exits immediately.
    const onAbort = () => {
      session.abort().catch(() => {});
      queue.close();
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const unsubscribe = session.subscribe((event) => {
      if (onRawModelMessage) {
        onRawModelMessage({
          engine: "pi",
          sessionId: String(conversationId),
          direction: "inbound",
          eventType: event.type,
          payload: event as unknown as Record<string, unknown>,
        });
      }

      // Emit context usage after each turn so the gauge shows accurate values.
      if (event.type === "turn_end") {
        const usage = session.getContextUsage();
        if (usage?.tokens != null) {
          queue.push({ type: "usage", inputTokens: usage.tokens, outputTokens: 0, contextWindow: piModel.contextWindow });
        }
      }

      for (const engineEvent of translateEvent(event as any, workingDirectory)) {
        queue.push(engineEvent);
      }
    });

    // Start the prompt. On error, push an error event and then close the queue.
    // On success, close the queue to signal end-of-stream.
    let resolvedPrompt: string;
    try {
      const resolved = await this.dialect.resolvePrompt(
        prompt,
        workingDirectory ?? process.cwd(),
        projectPath,
      );
      resolvedPrompt = resolved.content;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      queue.close();
      yield { type: "error", message: msg, fatal: true };
      return;
    }

    session
      .prompt(resolvedPrompt)
      .catch((err: unknown) => {
        agentError = err instanceof Error ? err : new Error(String(err));
      })
      .finally(() => {
        queue.close();
      });

    try {
      for await (const event of queue) {
        yield event;
      }
    } finally {
      signal?.removeEventListener("abort", onAbort);
      unsubscribe();
      this.pendingResumes.delete(executionId);
      this.executionToConversation.delete(executionId);
    }

    if (suspendedForDecision) {
      // Strip the trailing "aborted" assistant message Pi SDK adds after session.abort().
      // Without this, the next turn would start with a stale empty assistant turn in context.
      const agent = this.sessions.get(conversationId)?.agent;
      if (agent) {
        const msgs = agent.state.messages as any[];
        let end = msgs.length;
        while (end > 0) {
          const last = msgs[end - 1];
          if (last.role === "assistant" && last.stopReason === "aborted") {
            end--;
          } else {
            break;
          }
        }
        agent.state.messages = msgs.slice(0, end) as any;
      }
    }

    if (agentError && !suspendedForDecision) {
      // Pi pushes a { stopReason: "error" } message into agent._state.messages on failure.
      // If we reuse this agent on the next turn, that poison message is included in the
      // context snapshot sent to the LLM — causing the same error to repeat forever.
      // Fix: strip trailing error messages so the next turn starts from valid state.
      const agent = this.sessions.get(conversationId)?.agent;
      if (agent) {
        const msgs = agent.state.messages as any[];
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
    const conversationId = this.executionToConversation.get(executionId);
    if (conversationId !== undefined) {
      const session = this.sessions.get(conversationId);
      if (session) {
        session.abort().catch(() => {});
      }
    }
  }

  async listModels(): Promise<EngineModelInfo[]> {
    const providers = this.config.providers ?? {};
    if (Object.keys(providers).length === 0) {
      return [];
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
        const json = (await res.json()) as { data?: { id: string; context_length?: number }[] };
        for (const m of json.data ?? []) {
          // Skip embedding models — they can't be used for text generation
          if (m.id.includes("embed")) continue;
          const qualifiedId = `${this.engineId}/${providerId}/${m.id}`;
          results.push({
            qualifiedId,
            displayName: m.id,
            contextWindow: m.context_length ?? undefined,
            contextWindowEditable: true,
            supportsManualCompact: true,
          });
        }
      } catch (err) {
        console.warn(`[pi] listModels: provider "${providerId}" unreachable at ${baseUrl} —`, err instanceof Error ? err.message : err);
      }
    }

    return results;
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

  async compact(_taskId: number | null, conversationId: number, _workingDirectory: string): Promise<void> {
    const session = this.sessions.get(conversationId);
    if (!session) {
      console.warn(`[pi] compact(): no live session for conversation ${conversationId}, skipping`);
      return;
    }

    try {
      const result = await session.compact();
      if (result?.summary) {
        const db = getDb();
        appendMessage(db, null, conversationId, "compaction_summary", null, result.summary);
      }
    } catch (err) {
      console.error(`[pi] compact(): session.compact() failed for conversation ${conversationId}:`, err);
    }
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      try { session.dispose(); } catch { /* ignore */ }
    }
    this.sessions.clear();
    this.harnessContexts.clear();
    this.suspendRefs.clear();
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  /** Look up the project path for a task/board pair, for dialect resolution. */
  private async lookupProjectPath(taskId: number, boardId: number, worktreePath: string): Promise<string | undefined> {
    const { getDb } = await import("../../db/index.ts");
    const { getDefaultWorkspaceKey } = await import("../../workspace-context.ts");
    const { getLoadedProjectByKey } = await import("../../project-store.ts");

    const db = getDb();
    const taskRow = db
      .query<{ project_key: string }, [number]>(
        "SELECT project_key FROM tasks WHERE id = ?",
      )
      .get(taskId);

    if (!taskRow) return undefined;

    const wsKey =
      db.query<{ workspace_key: string }, [number]>(
        "SELECT workspace_key FROM boards WHERE id = ?",
      ).get(boardId)?.workspace_key ?? getDefaultWorkspaceKey();

    const project = getLoadedProjectByKey(wsKey, taskRow.project_key);
    if (project?.projectPath && project.projectPath !== worktreePath) {
      return project.projectPath;
    }
    return undefined;
  }

  /** Map<conversationId, HarnessContext> */
  private readonly harnessContexts = new Map<number, HarnessContext>();

  private getOrCreateSuspendRef(conversationId: number): { onSuspend?: (event: EngineEvent) => void } {
    let ref = this.suspendRefs.get(conversationId);
    if (!ref) {
      ref = {};
      this.suspendRefs.set(conversationId, ref);
    }
    return ref;
  }

  private getOrCreateHarnessContext(conversationId: number, worktreePath: string): HarnessContext {
    let ctx = this.harnessContexts.get(conversationId);
    if (!ctx) {
      ctx = {
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

  private async getOrCreateSession(
    conversationId: number,
    model: Model<"openai-completions">,
    tools: ReturnType<typeof buildAllTools>,
    systemPrompt: string | undefined,
    cwd: string,
    projectPath?: string,
  ): Promise<AgentSession> {
    const existing = this.sessions.get(conversationId);
    if (existing) {
      existing.agent.state.model = model as any;
      existing.agent.state.tools = tools as any;
      existing.agent.state.thinkingLevel = "off";
      if (systemPrompt !== undefined) existing.agent.state.systemPrompt = systemPrompt;
      return existing;
    }

    // Ensure sessions dir exists
    await mkdir(PI_SESSIONS_DIR, { recursive: true });

    const sessionPath = piSessionPathForConversation(conversationId);
    const sessionManager = SessionManager.open(sessionPath);

    const agentDir = getAgentDir();
    const skillPaths = this.dialect.getSkillPaths(cwd, projectPath);
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir,
      systemPromptOverride: () => systemPrompt,
      ...(skillPaths.length > 0 ? { additionalSkillPaths: skillPaths } : {}),
    });
    await resourceLoader.reload();

    const piTools = tools.map((t) =>
      defineTool({
        name: t.name,
        label: t.label ?? t.name,
        description: t.description,
        parameters: t.parameters as any,
        execute: t.execute as any,
      }),
    );

    const authStorage = AuthStorage.inMemory();
    // Pi always requires an API key value — local providers (LM Studio, Ollama) ignore it, so "no-key" is fine.
    // Set for all configured providers AND ensure model.provider always has a key.
    for (const [provider, cfg] of Object.entries(this.config.providers ?? {})) {
      authStorage.setRuntimeApiKey(provider, cfg.api_key ?? "no-key");
    }
    authStorage.setRuntimeApiKey(model.provider, this.config.providers?.[model.provider]?.api_key ?? "no-key");

    const { session } = await createAgentSession({
      cwd,
      agentDir,
      model: model as any,
      customTools: piTools,
      // Enable SDK built-in search tools (grep/find/ls) — auto-downloads ripgrep if needed.
      tools: ["grep", "find", "ls"],
      sessionManager,
      resourceLoader,
      authStorage,
    });

    // "off" prevents the SDK from sending reasoning_effort to local LLMs (LM Studio, Ollama),
    // which return 400 for that field. reasoning: true on the model is still kept so the
    // SDK can parse reasoning_content from models that return it in their response.
    session.agent.state.thinkingLevel = "off";

    this.sessions.set(conversationId, session);
    return session;
  }

  private buildModel(modelOverride?: string, contextWindowOverride?: number): Model<"openai-completions"> {
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
      contextWindow: contextWindowOverride ?? this.config.context_window ?? DEFAULT_CONTEXT_WINDOW,
      maxTokens: DEFAULT_MAX_TOKENS,
      // vLLM and other local providers don't support the OpenAI-only "developer" role.
      // Disabling this keeps system messages as role:"system" which all providers accept.
      compat: { supportsDeveloperRole: false },
    } as unknown as Model<"openai-completions">;
  }
}
