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
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { ModelSettingsRepository } from "../../db/repositories/model-settings-repository.ts";
import type { Model } from "@earendil-works/pi-ai";

/** Options passed to a SessionFactory when creating a new Pi agent session. */
export interface SessionFactoryOptions {
  tools: ReturnType<typeof buildAllTools>;
  systemPrompt: string | undefined;
  conversationId: number;
  model: Model<"openai-completions">;
  cwd: string;
  config: PiEngineConfig;
}

/**
 * Injectable factory for creating Pi agent sessions.
 * The default implementation calls createAgentSession from the Pi SDK.
 * Tests can inject a factory that uses a faux provider — no network, scripted responses.
 */
export type SessionFactory = (options: SessionFactoryOptions) => Promise<AgentSession>;
import { TodoRepository } from "../../db/todos.ts";
import { DecisionRepository } from "../../db/repositories/decision-repository.ts";
import { NoteRepository } from "../../db/repositories/note-repository.ts";
import { taskLspRegistry } from "../../lsp/task-registry.ts";
import { getConfig } from "../../config/index.ts";
import { UndoStack } from "./harness/undo-stack.ts";
import type { HarnessContext } from "./harness/context.ts";
import { buildAllTools } from "./tools/index.ts";
import { FileSystemSkillResolver } from "./skill-resolver.ts";
import { translateEvent } from "./event-translator.ts";
import { getDb } from "../../db/index.ts";
import { appendMessage } from "../../conversation/messages.ts";
import { AsyncQueue } from "./async-queue.ts";
import { createHash } from "crypto";
import { mkdir } from "fs/promises";
import { homedir } from "os";
import { join } from "path";

const PI_SESSIONS_DIR = join(homedir(), ".railyin", "pi-sessions");

/** SDK built-in tool names always included in the active tool set. */
const SDK_BUILTIN_TOOL_NAMES = ["read", "grep", "find", "ls"] as const;

function piSessionPathForConversation(conversationId: number): string {
  const hash = createHash("sha1").update(`railyin-pi-conversation-${conversationId}`).digest("hex");
  return join(PI_SESSIONS_DIR, `${hash}.jsonl`);
}

/** Default max tokens per response. */
const DEFAULT_MAX_TOKENS = 8_192;

/**
 * Production SessionFactory: creates a real Pi agent session using the SDK.
 * Reads session history from disk and connects to the configured LLM provider.
 */
async function defaultSessionFactory(options: SessionFactoryOptions): Promise<AgentSession> {
  const { tools, systemPrompt, conversationId, model, cwd, config } = options;

  const sessionPath = piSessionPathForConversation(conversationId);
  const sessionManager = SessionManager.open(sessionPath);

  const agentDir = getAgentDir();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    systemPromptOverride: () => systemPrompt,
  });
  await resourceLoader.reload();

  const piTools = tools.map((t) =>
    defineTool({
      name: t.name,
      label: t.label ?? t.name,
      description: t.description,
      parameters: t.parameters as any,
      prepareArguments: t.prepareArguments,
      execute: t.execute as any,
    }),
  );

  const authStorage = AuthStorage.inMemory();
  // Pi always requires an API key value — local providers (LM Studio, Ollama) ignore it, so "no-key" is fine.
  // Set for all configured providers AND ensure model.provider always has a key.
  for (const [provider, cfg] of Object.entries(config.providers ?? {})) {
    authStorage.setRuntimeApiKey(provider, cfg.api_key ?? "no-key");
  }
  authStorage.setRuntimeApiKey(model.provider, config.providers?.[model.provider]?.api_key ?? "no-key");

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model: model as any,
    customTools: piTools,
    // NOTE: The SDK's `tools` parameter acts as a GLOBAL allowlist that filters
    // both built-in and custom tools. We enable ALL active tools here.
    tools: [
      ...SDK_BUILTIN_TOOL_NAMES,
      "glob", "run_command", "undo_write",
      "fetch_url", "search_internet",
      "write_file", "patch_file", "delete_file", "rename_file",
      "get_task", "get_board_summary", "list_tasks",
      "create_task", "edit_task", "delete_task", "move_task", "message_task",
      "list_decisions", "record_decision", "update_decision", "delete_decision",
      "create_todo", "edit_todo", "list_todos", "get_todo", "reorganize_todos", "update_todo_status",
      "decision_request",
      "lsp_go_to_definition", "lsp_find_references", "lsp_document_symbols", "lsp_workspace_symbols",
      "lsp_hover", "lsp_rename", "lsp_incoming_calls", "lsp_outgoing_calls", "lsp_diagnostics", "lsp_type_definition",
      "skill",
    ],
    sessionManager,
    resourceLoader,
    authStorage,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    }),
  });

  // "off" prevents the SDK from sending reasoning_effort to local LLMs (LM Studio, Ollama),
  // which return 400 for that field.
  session.agent.state.thinkingLevel = "off";

  return session;
}

export class PiEngine implements ExecutionEngine {
  private readonly engineId: string;
  private readonly config: PiEngineConfig;
  private readonly _onTaskUpdated: OnTaskUpdated;
  private readonly dialect: SlashCommandDialect;
  private readonly modelSettingsRepo: ModelSettingsRepository;
  private readonly sessionFactory: SessionFactory;
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
    modelSettingsRepo: ModelSettingsRepository,
    sessionFactory: SessionFactory = defaultSessionFactory,
  ) {
    this.engineId = engineId;
    this.config = config;
    this._onTaskUpdated = onTaskUpdated;
    this.dialect = dialect;
    this.modelSettingsRepo = modelSettingsRepo;
    this.sessionFactory = sessionFactory;
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

    const commonCtx = this.getOrCreateCommonContext(
      conversationId,
      workingDirectory,
      taskId,
      boardId,
      boardTools,
      onTransition,
      onHumanTurn,
    );

    // Hoist project/skill path resolution so the skill resolver is ready before buildAllTools.
    const projectPath = boardId != null && taskId != null
      ? await this.lookupProjectPath(taskId, boardId, workingDirectory ?? process.cwd())
      : undefined;

    const skillPaths = this.dialect.getSkillPaths(workingDirectory ?? process.cwd(), projectPath);
    const skillResolver = new FileSystemSkillResolver(skillPaths);

    const tools = buildAllTools({ harnessCtx, commonCtx, skillResolver, suspendRef: this.getOrCreateSuspendRef(conversationId) });
    const piModel = this.buildModel(modelOverride, contextWindowOverride);

    // Look up the project path before session creation so it can be used when
    // wiring dialect skill paths into the Pi resource loader.
    const session = await this.getOrCreateSession(conversationId, piModel, tools, enrichedSystem, workingDirectory ?? process.cwd());

    this.executionToConversation.set(executionId, conversationId);

    // Use a buffered AsyncQueue as the push-to-pull bridge.
    // Unlike a single-callback approach, push() never loses a notification:
    // items buffer when nobody is waiting and are delivered immediately when consumed.
    // close() terminates the for-await instantly regardless of timing.
    const queue = new AsyncQueue<EngineEvent>();
    const errorRef: { error?: Error } = {};
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

    this.runPromptWithCompaction(session, resolvedPrompt, conversationId, queue, errorRef);

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

    if (errorRef.error && !suspendedForDecision) {
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
      const isTreeReduceBug = errorRef.error.message.includes("tree_reduce");
      const message = isTreeReduceBug
        ? `LM Studio MLX backend error: '${errorRef.error.message}'. ` +
          "This is a known bug in MLX models with conversation history. " +
          "Switch to a GGUF model (llama.cpp backend) in LM Studio to fix this."
        : errorRef.error.message;
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

  async compact(_taskId: number | null, conversationId: number, workingDirectory: string, workspaceKey: string): Promise<void> {
    let session = this.sessions.get(conversationId);
    if (!session) {
      const db = getDb();
      const row = db
        .query<{ model: string | null }, [number]>("SELECT model FROM conversations WHERE id = ?")
        .get(conversationId);
      const conversationModel = row?.model ?? null;
      if (!conversationModel) {
        throw new Error(`Cannot compact conversation ${conversationId}: no model stored for conversation`);
      }
      const contextWindow = this.modelSettingsRepo.getContextWindow(workspaceKey, conversationModel);
      if (contextWindow == null) {
        throw new Error(`Cannot compact conversation ${conversationId}: no context window configured for model "${conversationModel}"`);
      }
      session = await this.getOrCreateSession(conversationId, this.buildModel(conversationModel, contextWindow), [], undefined, workingDirectory);
    }

    if (session.isCompacting) {
      throw new Error("Compaction already in progress");
    }

    try {
      const result = await session.compact();
      if (result?.summary) {
        const db = getDb();
        appendMessage(db, null, conversationId, "compaction_summary", null, result.summary);
      }
    } catch (err) {
      console.error(`[pi] compact(): session.compact() failed for conversation ${conversationId}:`, err);
      throw err;
    }
  }

  async shutdown(): Promise<void> {
    for (const session of this.sessions.values()) {
      try { session.dispose(); } catch { /* ignore */ }
    }
    this.sessions.clear();
    this.harnessContexts.clear();
    this.commonCtxRefs.clear();
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
  /** Map<conversationId, CommonToolContext> — mutable ref so tool closures stay current without rebuilding. */
  private readonly commonCtxRefs = new Map<number, CommonToolContext>();

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

  private getOrCreateCommonContext(
    conversationId: number,
    workingDirectory: string | undefined,
    taskId: number | null | undefined,
    boardId: number | null | undefined,
    boardTools: ExecutionParams["boardTools"],
    onTransition: ExecutionParams["onTransition"],
    onHumanTurn: ExecutionParams["onHumanTurn"],
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
        onCancel: (id) => this.cancel(id),
        onTaskUpdated: (task) => this._onTaskUpdated(task),
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

  private async createNewSession(
    tools: ReturnType<typeof buildAllTools>,
    systemPrompt: string | undefined,
    conversationId: number,
    model: Model<"openai-completions">,
    cwd: string,
  ): Promise<AgentSession> {
    return this.sessionFactory({ tools, systemPrompt, conversationId, model, cwd, config: this.config });
  }

  private async getOrCreateSession(
    conversationId: number,
    model: Model<"openai-completions">,
    tools: ReturnType<typeof buildAllTools>,
    systemPrompt: string | undefined,
    cwd: string,
  ): Promise<AgentSession> {
    const existing = this.sessions.get(conversationId);
    if (existing) {
      existing.agent.state.model = model as any;
      existing.agent.state.thinkingLevel = "off";
      if (systemPrompt !== undefined) existing.agent.state.systemPrompt = systemPrompt;
      existing.setActiveToolsByName([...SDK_BUILTIN_TOOL_NAMES, ...tools.map((t) => t.name)]);
      return existing;
    }

    // Ensure sessions dir exists
    await mkdir(PI_SESSIONS_DIR, { recursive: true });
    const session = await this.createNewSession(tools, systemPrompt, conversationId, model, cwd);
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

    if (contextWindowOverride == null) {
      throw new Error(
        `No context window configured for model "${modelStr}". ` +
        "Set the context window in model settings before using this model.",
      );
    }

    return {
      id: modelId,
      name: nativeId,
      api: "openai-completions",
      provider: providerName ?? "default",
      baseUrl,
      reasoning: true,
      input: ["text"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: contextWindowOverride,
      maxTokens: DEFAULT_MAX_TOKENS,
      // vLLM and other local providers don't support the OpenAI-only "developer" role.
      // Disabling this keeps system messages as role:"system" which all providers accept.
      compat: { supportsDeveloperRole: false },
    } as unknown as Model<"openai-completions">;
  }

  private runPromptWithCompaction(
    session: AgentSession,
    resolvedPrompt: string,
    conversationId: number,
    queue: AsyncQueue<EngineEvent>,
    errorRef: { error?: Error },
  ): void {
    session
      .prompt(resolvedPrompt)
      .catch((err: unknown) => {
        errorRef.error = err instanceof Error ? err : new Error(String(err));
      })
      .finally(() => {
        queue.close();
      });
  }

}
