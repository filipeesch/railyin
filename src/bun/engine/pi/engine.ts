import type {
  ExecutionEngine,
  EngineType,
  ExecutionParams,
  EngineEvent,
  EngineModelInfo,
  CommandInfo,
  OnTaskUpdated,
} from "../types.ts";
import type { PiEngineConfig, PiModelConfig } from "../../config/index.ts";
import type { ModelSettingAxis, ModelParamValue } from "../../../shared/rpc-types.ts";
import { nativeModelIdFor, resolvePiModelConfig } from "./model-config.ts";
import type { SlashCommandDialect } from "../dialects/slash-command-dialect.ts";
import { NullDialect } from "../dialects/null-dialect.ts";
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
import { buildAllTools } from "./tools/index.ts";
import { getDb } from "../../db/index.ts";
import { ProviderLimiterRegistry, PROVIDER_LIMITER_DEFAULTS } from "./provider-limiter.ts";
import { formatPiError } from "./pi-error.ts";
import { validatePiEngineConfig } from "./pi-config-validation.ts";
import { LOOP_MAX_REPEAT, LOOP_WINDOW_SIZE } from "./harness/tool-loop-detector.ts";
import { buildToolAllowlist } from "./constants.ts";
import { join } from "path";
import { homedir } from "os";

// ─── Services ────────────────────────────────────────────────────────────────

import { PiModelBuilder } from "./model-builder.ts";
import { PiModelConfigApplier } from "./model-config-applier.ts";
import { PiDialectResolver } from "./dialect-resolver.ts";
import { PiToolFactory } from "./tool-factory.ts";
import { PiSessionManager, DefaultSessionPathResolver } from "./session-manager.ts";
import { DefaultRunDriver } from "./run-driver.ts";
import { PiCompactionCoordinator, DefaultMessageAppender } from "./compaction-coordinator.ts";
import { startExecution } from "./execution-controller.ts";

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

const PI_SESSIONS_DIR = join(homedir(), ".railyin", "pi-sessions");

/**
 * Production SessionFactory: creates a real Pi agent session using the SDK.
 * Reads session history from disk and connects to the configured LLM provider.
 */
async function defaultSessionFactory(options: SessionFactoryOptions): Promise<AgentSession> {
  const { tools, systemPrompt, conversationId, model, cwd, config } = options;

  const pathResolver = new DefaultSessionPathResolver(PI_SESSIONS_DIR);
  const sessionPath = pathResolver.pathForConversation(conversationId);
  const sessionManager = SessionManager.open(sessionPath);

  const agentDir = getAgentDir();
  const resourceLoader = new DefaultResourceLoader({
    cwd,
    agentDir,
    // Only pass systemPromptOverride when the resolved system prompt is non-empty.
    // Passing an override that returns undefined can yield an empty system prompt
    // for chat sessions, which may degrade behavior.
    ...(systemPrompt ? { systemPromptOverride: () => systemPrompt } : {}),
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
  for (const [provider, cfg] of Object.entries(config.providers ?? {})) {
    authStorage.setRuntimeApiKey(provider, cfg.api_key ?? "no-key");
  }
  authStorage.setRuntimeApiKey(model.provider, config.providers?.[model.provider]?.api_key ?? "no-key");

  const { session } = await createAgentSession({
    cwd,
    agentDir,
    model: model as any,
    customTools: piTools,
    tools: buildToolAllowlist(piTools),
    sessionManager,
    resourceLoader,
    authStorage,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false, reserveTokens: 16_384, keepRecentTokens: 20_000 },
    }),
  });

  return session;
}

export class PiEngine implements ExecutionEngine {
  readonly type: EngineType = "pi";
  private readonly engineId: string;
  private readonly config: PiEngineConfig;
  private readonly _onTaskUpdated: OnTaskUpdated;
  private readonly dialect: SlashCommandDialect;
  private readonly modelSettingsRepo: ModelSettingsRepository;
  /** Map<executionId, conversationId> — lets cancel() find the right session. */
  private readonly executionToConversation = new Map<number, number>();
  /** Map<conversationId, SuspendRef> */
  private readonly suspendRefs = new Map<number, { onSuspend?: (event: EngineEvent) => void }>();

  // ─── Services ───────────────────────────────────────────────────────────────

  /** Shared per-provider concurrency limiter. */
  readonly registry: ProviderLimiterRegistry;
  /** Model object builder. */
  readonly modelBuilder: PiModelBuilder;
  /** Per-model config → session thinking level + request-body merge. */
  readonly modelConfigApplier: PiModelConfigApplier;
  /** Dialect + project path resolution. */
  readonly dialectResolver: PiDialectResolver;
  /** Tool and harness context management. */
  readonly toolFactory: PiToolFactory;
  /** Session lifecycle management. */
  readonly sessionManager: PiSessionManager;
  /** Run driver wrapping prompt/continue/waitForIdle. */
  private readonly runDriver: DefaultRunDriver;
  /** Background compaction coordinator. */
  readonly compactionCoordinator: PiCompactionCoordinator;

  constructor(
    engineId: string,
    config: PiEngineConfig,
    onTaskUpdated: OnTaskUpdated,
    dialect: SlashCommandDialect = new NullDialect(),
    modelSettingsRepo: ModelSettingsRepository,
    sessionFactory: SessionFactory = defaultSessionFactory,
    registry?: ProviderLimiterRegistry,
    modelConfigApplier?: PiModelConfigApplier,
  ) {
    this.engineId = engineId;
    this.config = config;
    validatePiEngineConfig(config);
    this._onTaskUpdated = onTaskUpdated;
    this.dialect = dialect;
    this.modelSettingsRepo = modelSettingsRepo;

    this.registry = registry ?? new ProviderLimiterRegistry();
    for (const [name, providerCfg] of Object.entries(config.providers ?? {})) {
      this.registry.register(
        name,
        providerCfg.max_inflight ?? PROVIDER_LIMITER_DEFAULTS.max_inflight,
        providerCfg.queue_timeout_ms ?? PROVIDER_LIMITER_DEFAULTS.queue_timeout_ms,
      );
    }

    this.modelBuilder = new PiModelBuilder(config);
    for (const [name] of Object.entries(config.providers ?? {})) {
      this.modelBuilder.warnIfLmStudioOverloaded(name);
    }

    this.modelConfigApplier = modelConfigApplier ?? new PiModelConfigApplier();

    this.dialectResolver = new PiDialectResolver(dialect);

    this.toolFactory = new PiToolFactory(
      config,
      onTaskUpdated,
      (id) => this.cancel(id),
    );

    this.sessionManager = new PiSessionManager(
      sessionFactory,
      config,
      new DefaultSessionPathResolver(PI_SESSIONS_DIR),
    );

    this.runDriver = new DefaultRunDriver(this.registry);

    this.compactionCoordinator = new PiCompactionCoordinator(
      config,
      this.registry,
      new DefaultMessageAppender(),
    );
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
      onTransition,
      onHumanTurn,
      boardTools,
      contextWindowOverride,
      samplingPresetName,
      workspaceKey,
    } = params;

    if (signal?.aborted) {
      yield { type: "done" } as EngineEvent;
      return;
    }

    const taskBlock = taskContext
      ? [
          `## Task`,
          `**Title:** ${taskContext.title}`,
          ...(taskContext.description ? [`**Description:** ${taskContext.description}`] : []),
        ].join("\n")
      : undefined;
    const enrichedSystem = [taskBlock, systemInstructions].filter(Boolean).join("\n\n") || undefined;

    const cwd = workingDirectory ?? process.cwd();

    const projectPath = boardId != null && taskId != null
      ? await this.dialectResolver.lookupProjectPath(taskId, boardId, cwd)
      : undefined;

    const skillResolver = this.dialectResolver.getSkillResolver(cwd, projectPath);
    const suspendRef = this.getOrCreateSuspendRef(conversationId);

    const tools = this.toolFactory.buildTools(
      conversationId,
      cwd,
      workingDirectory,
      taskId,
      boardId,
      boardTools,
      onTransition,
      onHumanTurn,
      workspaceKey,
      skillResolver,
      suspendRef,
      signal,
      params.mcpRegistry,
      params.enabledMcpTools,
    );

    const piModel = this.modelBuilder.build(modelOverride, contextWindowOverride);
    const providerName = piModel.provider;

    const modelStr = modelOverride ?? this.config.model ?? "default";
    // Resolve the per-model config from the native (engine-stripped) model id so
    // provider-bearing qualified ids (e.g. pi-local/vllm/deepseek-v4-flash) reach
    // their config.models key (deepseek-v4-flash). Passing the full qualified id here
    // drops configured reasoning/variants, defaulting thinking to "off".
    const modelCfg = resolvePiModelConfig(this.config, nativeModelIdFor(modelStr));

    const session = await this.sessionManager.getOrCreate(conversationId, piModel, tools, enrichedSystem, cwd, modelOverride);

    this._applyModelConfigToSession(session, modelCfg, modelStr, samplingPresetName, params.modelParams);

    const harnessCtx = this.toolFactory.getOrCreateHarnessContext(conversationId, cwd, signal);
    harnessCtx.loopDetector.reset();
    session.agent.beforeToolCall = async (ctx) => {
      const looping = harnessCtx.loopDetector.record(ctx.toolCall.name, ctx.args as unknown);
      if (looping) {
        return {
          block: true,
          reason: `Tool loop detected: '${ctx.toolCall.name}' (or a group including it) has been called with the same arguments ${LOOP_MAX_REPEAT} times in the last ${LOOP_WINDOW_SIZE} calls. Try a different approach or summarize your findings.`,
        };
      }
      return undefined;
    };

    this.executionToConversation.set(executionId, conversationId);

    // Slash-command references are resolved upstream by the executor layer's
    // SlashCommandResolver, BEFORE historyBlock/decisionsBlock/stageInstructionsBlock
    // are joined into `prompt` — resolving here (on the full composed string) would
    // fail to match the dialect's leading "/command" pattern.
    const resolvedPrompt = prompt;

    // Start the execution loop. Events are pushed to `queue` by the event subscriber.
    const { queue, state, cleanup } = startExecution({
      session,
      resolvedPrompt,
      conversationId,
      piModel,
      providerName,
      workingDirectory,
      signal,
      suspendRef,
      runDriver: this.runDriver,
      compactionCoordinator: this.compactionCoordinator,
    });

    try {
      for await (const event of queue) {
        yield event;
      }
    } finally {
      cleanup();
      this.executionToConversation.delete(executionId);
    }

    const { suspendedForDecision, error } = state;

    if (suspendedForDecision) {
      const agent = this.sessionManager.get(conversationId)?.agent;
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

    if (error && !suspendedForDecision) {
      const agent = this.sessionManager.get(conversationId)?.agent;
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

      yield { type: "error", message: formatPiError(error), fatal: false };
      return;
    }

    yield { type: "done" };
  }

  async resume(_executionId: number, _input: never): Promise<void> {
    // All engine-level resume channels were trimmed with ask_user/shell_approval
    // (EngineResumeInput deleted). Decision interrupts resume via a NEW turn —
    // executeChatTurn/executeHumanTurn deliver the answer as engineContent —
    // never through engine.resume().
  }

  cancel(executionId: number): void {
    const conversationId = this.executionToConversation.get(executionId);
    if (conversationId !== undefined) {
      const session = this.sessionManager.get(conversationId);
      if (session) {
        session.abort().catch(() => {});
      }
    }
  }

  async listModels(): Promise<EngineModelInfo[]> {
    const providers = this.config.providers ?? {};
    if (Object.keys(providers).length === 0) return [];

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
          if (m.id.includes("embed")) continue;
          const qualifiedId = `${this.engineId}/${providerId}/${m.id}`;
          const modelCfg = resolvePiModelConfig(this.config, `${providerId}/${m.id}`)
            ?? resolvePiModelConfig(this.config, m.id);
          const settings = this._buildSettings(modelCfg);
          const presetNames = modelCfg?.sampling_presets ? Object.keys(modelCfg.sampling_presets) : [];
          const availablePresets = presetNames.map((name) => ({
            name,
            params: modelCfg!.sampling_presets![name],
          }));
          results.push({
            qualifiedId,
            displayName: modelCfg?.name ?? m.id,
            contextWindow: m.context_length ?? undefined,
            contextWindowEditable: true,
            supportsManualCompact: true,
            ...(settings.length > 0 ? { settings } : {}),
            ...(availablePresets.length > 0 ? { availablePresets } : {}),
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
    let session = this.sessionManager.get(conversationId);
    // Track whether we had to spin up a session just for this compaction call
    // (no live session was in memory). Such a session is built with an empty
    // `tools` list — the SDK's AgentSession registers custom tool implementations
    // once, at construction, from that list. Reusing this session later would
    // permanently limit it to SDK built-ins (read/grep/find/ls) even though a
    // full `tools` array is passed on every subsequent turn, because
    // `setActiveToolsByName()` can only activate tools already in the registry.
    // We therefore dispose it once compaction finishes so the next real
    // execution builds a fresh session with the full tool set.
    const isShadowSession = !session;
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
      session = await this.sessionManager.getOrCreate(
        conversationId,
        this.modelBuilder.build(conversationModel, contextWindow),
        [],
        undefined,
        workingDirectory,
        conversationModel,
      );
    }

    if (session.isCompacting) {
      throw new Error("Compaction already in progress");
    }

    try {
      const result = await session.compact();
      // 07-01 (D-05): the compaction_summary conversation_messages row no
      // longer persists — conversation_messages is a frozen table. The pi
      // engine's compact() itself stays live; only the persisted summary row
      // goes away.
      void result;
    } catch (err) {
      console.error(`[pi] compact(): session.compact() failed for conversation ${conversationId}:`, err);
      throw err;
    } finally {
      if (isShadowSession) {
        this.sessionManager.dispose(conversationId);
      }
    }
  }

  async shutdown(): Promise<void> {
    this.sessionManager.disposeAll();
    await this.compactionCoordinator.waitForAll();
    this.toolFactory.clear();
    this.suspendRefs.clear();
  }

  getPiProviderStatus(): import("./provider-limiter.ts").ProviderLimiterSnapshot[] {
    return this.registry.snapshots();
  }

  // ─── Private helpers ────────────────────────────────────────────────────────

  private getOrCreateSuspendRef(conversationId: number): { onSuspend?: (event: EngineEvent) => void } {
    let ref = this.suspendRefs.get(conversationId);
    if (!ref) {
      ref = {};
      this.suspendRefs.set(conversationId, ref);
    }
    return ref;
  }

  /**
   * Builds the normalized `ModelSettingAxis[]` for a Pi model: a "Mode" axis from
   * `variants` when present, plus any explicit `axes` declared in config.
   */
  _buildSettings(modelCfg: PiModelConfig | undefined): ModelSettingAxis[] {
    return this.modelConfigApplier.buildSettings(modelCfg);
  }

  /**
   * Applies the per-model config to `session.agent` for the current execution.
   * Delegates to the injectable PiModelConfigApplier service.
   */
  _applyModelConfigToSession(
    session: AgentSession,
    modelCfg: PiModelConfig | undefined,
    modelStr: string,
    presetName: string | undefined,
    modelParams: ModelParamValue[] | undefined,
  ): void {
    this.modelConfigApplier.applyToSession(session, modelCfg, modelStr, presetName, modelParams);
  }

  // ─── Compatibility shims for tests that access private state via `as any` ───

  /** @deprecated Access via engine.sessionManager.sessions */
  private get sessions() { return this.sessionManager.sessions; }
  /** @deprecated Access via engine.toolFactory.harnessContexts */
  private get harnessContexts() { return this.toolFactory.harnessContexts; }
  /** @deprecated Access via engine.toolFactory.commonCtxRefs */
  private get commonCtxRefs() { return this.toolFactory.commonCtxRefs; }
  /** @deprecated Access via engine.compactionCoordinator.bgCompactions */
  private get bgCompactions() { return this.compactionCoordinator.bgCompactions; }

  /** @deprecated Use engine.sessionManager.getOrCreate() */
  private getOrCreateSession(
    conversationId: number,
    model: Model<"openai-completions">,
    tools: ReturnType<typeof buildAllTools>,
    systemPrompt: string | undefined,
    cwd: string,
    qualifiedModelId: string,
  ) {
    return this.sessionManager.getOrCreate(conversationId, model, tools, systemPrompt, cwd, qualifiedModelId);
  }
}
