import type { ExecutionEngine, ExecutionParams, EngineEvent, EngineModelInfo, EngineResumeInput, CommandInfo } from "../types.ts";
import type { OnTaskUpdated, OnNewMessage } from "../../workflow/engine.ts";
import type { ClaudeRunConfig, ClaudeSdkAdapter } from "./adapter.ts";
import { claudeSessionIdForTask, createDefaultClaudeSdkAdapter } from "./adapter.ts";
import type { ToolMetadata } from "./events.ts";
import { taskLspRegistry } from "../../lsp/task-registry.ts";
import { getConfig } from "../../config/index.ts";
import { readdirSync, existsSync, readFileSync } from "fs";
import { join, relative, extname, basename } from "path";
import { getMcpRegistry } from "../../mcp/registry.ts";

export class ClaudeEngine implements ExecutionEngine {
  private readonly defaultModel: string | undefined;
  private readonly sdkAdapter: ClaudeSdkAdapter;
  private readonly pendingResumes = new Map<number, {
    resolve: (input: EngineResumeInput) => void;
    reject: (error: Error) => void;
  }>();

  constructor(
    defaultModel: string | undefined,
    _onTaskUpdated: OnTaskUpdated,
    _onNewMessage: OnNewMessage,
    sdkAdapter: ClaudeSdkAdapter = createDefaultClaudeSdkAdapter(),
  ) {
    this.defaultModel = defaultModel;
    this.sdkAdapter = sdkAdapter;
  }

  execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
    const { executionId, taskId, boardId, workingDirectory, model, prompt, signal, systemInstructions, enabledMcpTools } = params;

    // Create a map to track tool metadata (tool_use blocks) for pairing with tool_result blocks
    const toolMetaByCallId = new Map<string, ToolMetadata>();

    const config = getConfig();
    const lspManager = taskLspRegistry.getManager(
      taskId,
      config.workspace.lsp?.servers ?? [],
      workingDirectory,
    );

    // Collect external MCP server configs from the registry for native Claude pass-through.
    const mcpRegistry = getMcpRegistry();
    const externalMcpServers = mcpRegistry
      ? mcpRegistry.getStatus()
          .filter((s) => s.state === "running")
          .map((s) => mcpRegistry.getServerConfig(s.name))
          .filter((c): c is NonNullable<typeof c> => c !== undefined)
      : undefined;

    const runConfig: ClaudeRunConfig = {
      executionId,
      taskId,
      prompt,
      workingDirectory,
      model: model || this.defaultModel,
      systemInstructions,
      signal,
      sessionId: claudeSessionIdForTask(taskId),
      commonToolContext: {
        taskId,
        boardId: boardId ?? 0,
        onTransition: () => { },
        onHumanTurn: () => { },
        onCancel: (id) => this.cancel(id),
        lspManager,
        worktreePath: workingDirectory,
      },
      waitForResume: (request) => this.waitForResume(executionId, request, signal),
      onRawMessage: (message) => {
        params.onRawModelMessage?.({
          engine: "claude",
          sessionId: claudeSessionIdForTask(taskId),
          direction: "inbound",
          eventType: String(message.type ?? "unknown"),
          eventSubtype: typeof message.subtype === "string" ? message.subtype : undefined,
          payload: message,
        });
      },
      toolMetaByCallId,
      externalMcpServers,
      enabledMcpTools,
    };

    // Wrap the adapter execution to ensure cleanup happens
    return this.createManagedExecution(runConfig, toolMetaByCallId);
  }

  private async *createManagedExecution(config: ClaudeRunConfig, toolMetaByCallId: Map<string, any>): AsyncGenerator<EngineEvent> {
    try {
      for await (const event of this.sdkAdapter.run(config)) {
        yield event;
      }
    } finally {
      // Clean up tool metadata map on execution end
      toolMetaByCallId.clear();
    }
  }

  async resume(executionId: number, input: EngineResumeInput): Promise<void> {
    this.sdkAdapter.touchExecutionLease?.(executionId, "running");
    const pending = this.pendingResumes.get(executionId);
    if (!pending) {
      throw new Error(`Execution ${executionId} is not waiting for resume input`);
    }
    this.pendingResumes.delete(executionId);
    pending.resolve(input);
  }

  cancel(executionId: number): void {
    const pending = this.pendingResumes.get(executionId);
    if (pending) {
      this.pendingResumes.delete(executionId);
      pending.reject(new Error(`Execution ${executionId} cancelled`));
    }
    void this.sdkAdapter.cancel(executionId).catch(() => { });
  }

  async listModels(): Promise<EngineModelInfo[]> {
    const models = await this.sdkAdapter.listModels(process.cwd());
    return models.map((model) => ({
      qualifiedId: `claude/${model.value}`,
      displayName: model.displayName,
      description: model.description,
      supportsThinking: model.supportsEffort || model.supportsAdaptiveThinking,
    }));
  }

  async listCommands(taskId: number): Promise<CommandInfo[]> {
    const { getDb } = await import("../../db/index.ts");
    const { getBoardWorkspaceKey } = await import("../../workspace-context.ts");
    const { getProjectByKey } = await import("../../project-store.ts");

    const db = getDb();
    const taskRow = db
      .query<{ board_id: number; project_key: string }, [number]>(
        "SELECT board_id, project_key FROM tasks WHERE id = ?",
      )
      .get(taskId);

    if (!taskRow) return [];

    const gitRow = db
      .query<{ worktree_path: string | null }, [number]>(
        "SELECT worktree_path FROM task_git_context WHERE task_id = ?",
      )
      .get(taskId);

    const wsKey = getBoardWorkspaceKey(taskRow.board_id);
    const project = getProjectByKey(wsKey, taskRow.project_key);
    const cwd = project?.projectPath?.trim() || gitRow?.worktree_path || process.cwd();

    const sdkCommands = await this.sdkAdapter.listCommands(cwd);
    return sdkCommands.map((cmd) => ({
      name: cmd.name,
      description: cmd.description || undefined,
    }));
  }

  async shutdown(options: import("../types.ts").EngineShutdownOptions = { reason: "app-exit", deadlineMs: 3_000 }): Promise<void> {
    await this.sdkAdapter.shutdownAll?.(options);
  }

  private waitForResume(
    executionId: number,
    _request: { type: "ask_user" | "shell_approval" },
    signal?: AbortSignal,
  ): Promise<EngineResumeInput> {
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
}

// ─── Claude command discovery ─────────────────────────────────────────────────

/** Extract `description` value from YAML frontmatter (`---\ndescription: ...\n---`). */
function parseFrontmatterDescription(filePath: string): string | undefined {
  try {
    const content = readFileSync(filePath, "utf8");
    const match = content.match(/^---[\r\n]([\s\S]*?)[\r\n]---/);
    if (!match) return undefined;
    const descLine = match[1].match(/^description:\s*(.+)$/m);
    return descLine ? descLine[1].trim() : undefined;
  } catch {
    return undefined;
  }
}

export function collectClaudeCommands(
  dir: string,
  prefix: string,
  seen: Set<string>,
  out: CommandInfo[],
): void {
  if (!existsSync(dir)) return;
  let entries: import("fs").Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      collectClaudeCommands(fullPath, prefix ? `${prefix}:${entry.name}` : entry.name, seen, out);
    } else if (entry.isFile() && extname(entry.name) === ".md") {
      const stem = basename(entry.name, ".md");
      const commandName = prefix ? `${prefix}:${stem}` : stem;
      if (!seen.has(commandName)) {
        seen.add(commandName);
        out.push({ name: commandName, description: parseFrontmatterDescription(fullPath) });
      }
    }
  }
}
