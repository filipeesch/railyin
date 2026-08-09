import type { Attachment } from "../../../shared/rpc-types.ts";
import type { Database } from "bun:sqlite";
import { getDefaultWorkspaceKey, getWorkspaceConfig } from "../../workspace-context";
import { getEffectiveWorkspacePath } from "../../config/path-utils";
import type { EngineRegistry } from "../engine-registry";
import type { ExecutionParamsBuilder } from "./execution-params-builder";
import type { IWorkingDirectoryResolver } from "./working-directory-resolver";
import type { StreamProcessor } from "../stream/stream-processor";
import type { TaskRow } from "../../db/row-types";
import { QualifiedModelId } from "../qualified-model-id";
import { CustomPromptInjector, type PromptFilterContext } from "./custom-prompt-injector.ts";
import type { ExecutionParamsEnricher } from "./execution-params-enricher.ts";
import type { IBoardToolExecutor } from "../../workflow/tools/board-tool-executor.ts";
import { CrossEngineContextInjector } from "../../conversation/cross-engine-context.ts";
import { SlashCommandResolver } from "./slash-command-resolver.ts";


export class ChatExecutor {
  constructor(
    private readonly db: Database,
    private readonly engineRegistry: EngineRegistry,
    private readonly paramsBuilder: ExecutionParamsBuilder,
    private readonly streamProcessor: StreamProcessor,
    private readonly workdirResolver: IWorkingDirectoryResolver,
    private readonly customPromptInjector: CustomPromptInjector,
    private readonly crossEngineInjector: CrossEngineContextInjector,
    private readonly slashCommandResolver: SlashCommandResolver,
    private readonly paramsEnricher?: ExecutionParamsEnricher,
    private readonly boardTools?: IBoardToolExecutor,
  ) {}

  async execute(
    sessionId: number,
    conversationId: number,
    content: string,
    model?: string,
    enabledMcpTools?: string[] | null,
    workspaceKey = getDefaultWorkspaceKey(),
    attachments?: Attachment[],
    engineContent?: string,
    opts?: import("../coordinator.ts").ChatTurnOpts,
  ): Promise<{ executionId: number }> {
    const db = this.db;
    const config = getWorkspaceConfig(workspaceKey);

    const conversationRow = db
      .prepare(`
        SELECT c.model, c.last_engine_type, t.id as task_id, t.title, t.description,
               t.project_key, t.board_id, t.conversation_id as task_conv_id,
               t.execution_state, t.created_at
        FROM conversations c
        LEFT JOIN tasks t ON t.id = c.task_id
        WHERE c.id = ?
      `)
      .get(conversationId) as {
        model: string | null;
        last_engine_type: string | null;
        task_id: number | null;
        title: string | null;
        description: string | null;
        project_key: string | null;
      } & Partial<TaskRow> | undefined;

    const conversationModel = conversationRow;
    const taskContext = conversationRow?.title
      ? {
          title: conversationRow.title,
          ...(conversationRow.description?.trim() ? { description: conversationRow.description.trim() } : {}),
        }
      : undefined;
    const modelValue = conversationModel?.model ?? null;

    const effectiveModel = model ?? modelValue ?? "";

    if (effectiveModel && effectiveModel !== modelValue) {
      db.run("UPDATE conversations SET model = ? WHERE id = ?", [effectiveModel, conversationId]);
    }

    // For task-linked conversations, resolve the task's worktree path so write tools
    // operate in the correct directory. Fall back to workspace root for pure chat sessions.
    let workingDirectory = getEffectiveWorkspacePath(config);
    if (conversationRow?.task_id && this.workdirResolver) {
      try {
        workingDirectory = this.workdirResolver.resolve(conversationRow as unknown as TaskRow);
      } catch {
        // worktree not ready yet — workspace root is acceptable fallback
      }
    }
    const engine = this.engineRegistry.resolveEngineForModel(workspaceKey, effectiveModel);

    // Resolve custom prompts for chat execution
    const engineId = QualifiedModelId.tryParse(effectiveModel)?.engineId ?? config.engines[0]?.id ?? "copilot";

    const contextWindowOverride = this.paramsEnricher?.hasContextWindow(workspaceKey, effectiveModel) ?? false;

    // Pre-flight: Pi requires a configured context window — fail fast with a visible error.
    // Check the engine TYPE (catches custom Pi engine ids like `pi-local`, `pi-openrouter`)
    // OR the engineId (catches the standard `pi/...` qualified model). This guards against
    // Pi engines silently failing when the engine id differs from the literal `pi`.
    if ((engine.type === "pi" || engineId === "pi") && !contextWindowOverride) {
      db.run("UPDATE chat_sessions SET status = 'idle' WHERE conversation_id = ?", [conversationId]);
      // No message row is persisted (zero conversation_messages writes); the
      // caller gets a sentinel executionId and the error surfaces via the
      // engine/board failure channels.
      return { executionId: -1 };
    }

    const targetModelInfo = (await engine.listModels()).find(m => m.qualifiedId === effectiveModel);
    const { historyBlock } = await this.crossEngineInjector.prepareSwitch(
      conversationId,
      engineId,
      targetModelInfo,
      workingDirectory,
      workspaceKey,
      engine.type,
    );

    const resolvedChatTail = await this.slashCommandResolver.resolve(
      config,
      engineId,
      engineContent ?? content,
      workingDirectory,
      conversationRow?.project_key ? config.projects.find((p) => p.key === conversationRow.project_key)?.projectPath : undefined,
    );
    const enginePrompt = [historyBlock, resolvedChatTail].filter(Boolean).join("\n\n");

    const promptFilter: PromptFilterContext = {
      modelId: effectiveModel,
      engineId,
      executionType: "chat",
      projectPath: workingDirectory,
    };
    const customSystemInstructions = this.customPromptInjector.resolve(promptFilter);

    const execResult = db.run(
      `INSERT INTO executions (task_id, conversation_id, from_state, to_state, prompt_id, status, attempt)
       VALUES (NULL, ?, 'chat', 'chat', 'chat-turn', 'running', 1)`,
      [conversationId],
    );
    const executionId = execResult.lastInsertRowid as number;

    db.run("UPDATE chat_sessions SET status = 'running' WHERE conversation_id = ?", [conversationId]);

    const signal = this.streamProcessor.createSignal(executionId);

    const chatBase = {
      ...this.paramsBuilder.buildForChat(
        conversationId,
        executionId,
        enginePrompt,
        workingDirectory,
        effectiveModel,
        workspaceKey,
        signal,
        enabledMcpTools ?? null,
        attachments,
        taskContext,
      ),
      ...(customSystemInstructions ? { systemInstructions: customSystemInstructions } : {}),
      ...(this.boardTools ? { boardTools: this.boardTools } : {}),
      onSoftCancel: () => this.streamProcessor.abort(executionId),
    };

    const execParams = this.paramsEnricher
      ? this.paramsEnricher.enrich(chatBase, {
          workspaceKey,
          conversationId,
          model: effectiveModel,
        })
      : chatBase;

    this.streamProcessor.runNonNative(null, conversationId, executionId, engine, execParams, opts);
    db.run("UPDATE conversations SET last_engine_type = ? WHERE id = ?", [engineId, conversationId]);

    return { executionId };
  }
}
