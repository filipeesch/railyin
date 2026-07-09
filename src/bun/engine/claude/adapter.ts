import { createHash } from "crypto";
import type { CommonToolContext, EngineEvent, EngineResumeInput } from "../types.ts";
import { buildClaudeToolServer } from "./tools.ts";
import { translateClaudeMessage, type ToolMetadata } from "./events.ts";
import type { FileStateCache } from "./file-state-cache.ts";
import { ShellApprovalRepository, getUnapprovedShellBinaries, type ShellApprovalScope } from "../../db/repositories/shell-approval-repository.ts";
import { LeaseRegistry } from "../lease-registry.ts";
import type { EngineLeaseState, EngineShutdownOptions } from "../types.ts";
import type { McpServerConfig } from "../../mcp/types.ts";

export interface ClaudeSdkModelInfo {
  value: string;
  displayName: string;
  description?: string;
  supportsEffort?: boolean;
  supportsAdaptiveThinking?: boolean;
  supportedEffortLevels?: string[];
  defaultEffortLevel?: string;
}

export interface ClaudeResumeRequest {
  type: "ask_user";
  payload: string;
}

export interface ClaudeShellApprovalRequest {
  type: "shell_approval";
  command: string;
}

export interface ClaudeRunConfig {
  executionId: number;
  taskId: number | null;
  shellScope: ShellApprovalScope;
  prompt: string;
  workingDirectory: string;
  model?: string;
  systemInstructions?: string;
  /** Task identity context injected via SessionStart hook additionalContext. */
  taskContext?: { title: string; description?: string };
  signal?: AbortSignal;
  sessionId: string;
  commonToolContext: CommonToolContext;
  waitForResume: (request: ClaudeResumeRequest | ClaudeShellApprovalRequest) => Promise<EngineResumeInput>;
  onRawMessage?: (message: Record<string, unknown>) => void;
  toolMetaByCallId?: Map<string, ToolMetadata>;
  /** Captures file content before write/edit tools for accurate per-call diffs. */
  fileStateCache?: FileStateCache;
  /** External MCP server configs to pass natively to the Claude SDK. */
  externalMcpServers?: McpServerConfig[];
  /** Tool filter: null = all enabled, string[] = "server:tool" pairs that are enabled. */
  enabledMcpTools?: string[] | null;
}

export interface ClaudeSdkAdapter {
  run(config: ClaudeRunConfig): AsyncIterable<EngineEvent>;
  cancel(executionId: number): Promise<void>;
  listModels(workingDirectory: string): Promise<ClaudeSdkModelInfo[]>;
  listCommands(workingDirectory: string): Promise<Array<{ name: string; description: string }>>;
  touchExecutionLease?(executionId: number, state?: EngineLeaseState): void;
  shutdownAll?(options?: EngineShutdownOptions): Promise<void>;
}

interface ActiveClaudeQuery {
  interrupt?: () => Promise<void>;
  close?: () => void;
  sessionId: string;
}

type ClaudeSdkRuntime = {
  /**
   * Starts a Claude Code query. Supports `resume` (continue existing session) and
   * `sessionId` (create new session with a specific UUID). Using `sessionId` on an
   * already-existing session causes Claude Code to exit with code 1 — always use
   * `resume` for existing sessions.
   */
  query: (params: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<unknown> & {
    supportedModels?: () => Promise<Array<Record<string, unknown>>>;
    supportedCommands?: () => Promise<Array<{ name: string; description: string }>>;
    interrupt?: () => Promise<void>;
    close?: () => void;
  };
  /**
   * Returns metadata for a single session by ID (title, lastModified, cwd, etc.).
   * Returns `undefined` if the session file is not found, is a sidechain session,
   * or has no extractable summary (i.e. no `"type":"summary"` entry in the JSONL).
   * DO NOT use this to check whether a session exists — it returns `undefined` for
   * valid sessions that have never been compacted. Use `getSessionMessages` instead.
   */
  getSessionInfo?: (sessionId: string) => Promise<unknown>;
  /**
   * Returns the conversation messages for a session. Returns an empty array `[]`
   * if the session file is not found. Use this to reliably detect session existence:
   * `(await getSessionMessages(id, { dir, limit: 1 })).length > 0`
   *
   * The `dir` option scopes the search to a specific project directory (same as `cwd`
   * passed to `query`). The `limit` option caps how many messages are returned.
   */
  getSessionMessages?: (sessionId: string, options?: { dir?: string; limit?: number }) => Promise<unknown[]>;
  createSdkMcpServer: (options: { name: string; version?: string; tools?: unknown[] }) => unknown;
  tool: (
    name: string,
    description: string,
    inputSchema: Record<string, unknown>,
    handler: (args: Record<string, unknown>, extra: unknown) => Promise<Record<string, unknown>>,
  ) => unknown;
};

type ZodRuntime = {
  z: {
    string: () => { optional: () => unknown };
    number: () => { optional: () => unknown };
    boolean: () => { optional: () => unknown };
    any: () => { optional: () => unknown };
    array: (item: unknown) => { optional: () => unknown };
    object: (shape: Record<string, unknown>) => { optional: () => unknown };
    enum: (values: [string, ...string[]]) => { optional: () => unknown };
  };
};


async function loadClaudeRuntime(): Promise<ClaudeSdkRuntime> {
  const moduleName = "@anthropic-ai/claude-agent-sdk";
  return await import(moduleName) as unknown as ClaudeSdkRuntime;
}

async function loadZodRuntime(): Promise<ZodRuntime> {
  const moduleName = "zod";
  return await import(moduleName) as unknown as ZodRuntime;
}

function buildAskUserPayload(message: string, requestedSchema?: Record<string, unknown>): string {
  const properties = requestedSchema && typeof requestedSchema === "object"
    ? (requestedSchema.properties as Record<string, Record<string, unknown>> | undefined)
    : undefined;

  const firstProp = properties ? Object.values(properties)[0] : undefined;
  const options = Array.isArray(firstProp?.enum)
    ? (firstProp!.enum as unknown[]).map((value) => ({ label: String(value) }))
    : [];

  return JSON.stringify({
    questions: [{
      question: message,
      selection_mode: "single",
      options,
    }],
  });
}

function extractShellCommand(toolName: string, input: Record<string, unknown>, title?: string): string {
  if (toolName === "Bash" && typeof input.command === "string") {
    return input.command;
  }
  if (title?.trim()) return title;
  return `${toolName} ${JSON.stringify(input)}`;
}

function normalizeClaudeModel(model?: string): string | undefined {
  if (!model) return undefined;
  return model.startsWith("claude/") ? model.slice("claude/".length) : model;
}

/**
 * Convert our internal McpServerConfig list to the format the Claude Agent SDK
 * expects for external mcpServers (transport config keyed by server name).
 * Servers with no enabled tools are excluded when a filter is provided.
 */
function buildExternalMcpServers(
  servers: McpServerConfig[] | undefined,
  enabledMcpTools: string[] | null | undefined,
): Record<string, unknown> {
  if (!servers?.length) return {};
  const result: Record<string, unknown> = {};
  for (const srv of servers) {
    // If a filter is provided, only include servers with at least one enabled tool.
    if (Array.isArray(enabledMcpTools)) {
      const hasEnabled = enabledMcpTools.some((t) => t.startsWith(`${srv.name}:`));
      if (!hasEnabled) continue;
    }
    result[srv.name] = srv.transport;
  }
  return result;
}

/**
 * Build the allowedTools list for external MCP servers.
 *
 * The SDK's allowedTools option pre-approves tools so they run without a permission prompt.
 * Tool names follow the pattern `mcp__{server-name}__{tool-name}`.
 *
 * Our internal enabledMcpTools filter uses `"serverName:toolName"` format — translate to
 * SDK format here. When enabledMcpTools is null (all enabled), emit a wildcard per server.
 * When a specific list is provided, translate each entry to its SDK-format tool name.
 *
 * Ref: https://code.claude.com/docs/en/agent-sdk/mcp#allow-mcp-tools
 */
function buildAllowedExternalMcpTools(
  servers: McpServerConfig[] | undefined,
  enabledMcpTools: string[] | null | undefined,
): string[] {
  if (!servers?.length) return [];
  const allowed: string[] = [];
  for (const srv of servers) {
    if (!Array.isArray(enabledMcpTools)) {
      // null = all tools enabled — use a wildcard for this server.
      allowed.push(`mcp__${srv.name}__*`);
    } else {
      // Translate "serverName:toolName" → "mcp__serverName__toolName".
      for (const entry of enabledMcpTools) {
        const colonIdx = entry.indexOf(":");
        if (colonIdx === -1) continue;
        const serverName = entry.slice(0, colonIdx);
        const toolName = entry.slice(colonIdx + 1);
        if (serverName === srv.name) {
          allowed.push(`mcp__${serverName}__${toolName}`);
        }
      }
    }
  }
  return allowed;
}

export function buildAllowPermissionResult(
  toolInput: Record<string, unknown>,
  suggestions?: unknown,
): Record<string, unknown> {
  if (Array.isArray(suggestions)) {
    return {
      behavior: "allow",
      updatedInput: toolInput,
      updatedPermissions: suggestions,
    };
  }

  return {
    behavior: "allow",
    updatedInput: toolInput,
  };
}

function permissionDecisionToResult(
  input: EngineResumeInput,
  toolInput: Record<string, unknown>,
  suggestions?: unknown,
): Record<string, unknown> {
  if (input.type !== "shell_approval" || input.decision === "deny") {
    return {
      behavior: "deny",
      message: "Denied by user",
    };
  }

  return buildAllowPermissionResult(
    toolInput,
    input.decision === "approve_all" ? suggestions : undefined,
  );
}

export { getUnapprovedShellBinaries };


export function claudeSessionIdForTask(taskId: number): string {
  const hash = createHash("sha1").update(`railyin-claude-task-${taskId}`).digest("hex");
  return claudeSessionIdFromHash(hash);
}

export function claudeSessionIdForConversation(taskId: number | null, conversationId: number): string {
  const hash = createHash("sha1")
    .update(taskId != null ? `railyin-claude-task-${taskId}` : `railyin-claude-conversation-${conversationId}`)
    .digest("hex");
  return claudeSessionIdFromHash(hash);
}

function claudeSessionIdFromHash(hash: string): string {
  const raw = [
    hash.slice(0, 8),
    hash.slice(8, 12),
    `5${hash.slice(13, 16)}`,
    `8${hash.slice(17, 20)}`,
    hash.slice(20, 32),
  ];
  return raw.join("-");
}

class DefaultClaudeSdkAdapter implements ClaudeSdkAdapter {
  private readonly idleTimeoutMs = Number(process.env.RAILYN_ENGINE_IDLE_TIMEOUT_MS ?? 10 * 60 * 1000);
  private readonly activeQueries = new Map<number, ActiveClaudeQuery>();
  private readonly executionToSession = new Map<number, string>();
  private readonly leaseExecutions = new Map<string, Set<number>>();
  private _modelsFetch: Promise<ClaudeSdkModelInfo[]> | null = null;
  private readonly shellApprovalRepo: ShellApprovalRepository;

  constructor(shellApprovalRepo?: ShellApprovalRepository) {
    this.shellApprovalRepo = shellApprovalRepo ?? new ShellApprovalRepository();
  }

  private readonly leases = new LeaseRegistry(
    "claude",
    this.idleTimeoutMs,
    async (leaseKey) => {
      await this.closeLeaseExecutions(leaseKey, "timeout-expiry");
    },
  );

  run(config: ClaudeRunConfig): AsyncIterable<EngineEvent> {
    return this._run(config);
  }

  private async *_run(config: ClaudeRunConfig): AsyncGenerator<EngineEvent> {
    const queue: EngineEvent[] = [];
    let notify: (() => void) | null = null;
    let done = false;

    const wake = () => {
      if (notify) {
        const next = notify;
        notify = null;
        next();
      }
    };

    const emit = (event: EngineEvent) => {
      queue.push(event);
      wake();
    };

    const abortController = new AbortController();
    config.signal?.addEventListener("abort", () => abortController.abort(), { once: true });

    (async () => {
      try {
        const [sdk, zod] = await Promise.all([loadClaudeRuntime(), loadZodRuntime()]);
        const toolContext = {
          ...config.commonToolContext,
        };
        const { server: toolServer, takePendingSuspend } = buildClaudeToolServer(sdk, zod.z, toolContext);
        // Use getSessionMessages to check session existence — getSessionInfo is unreliable
        // for sessions without a summary entry (returns undefined even when the file exists).
        // getSessionMessages returns [] if the session file is not found.
        const sessionMessages = await sdk.getSessionMessages?.(config.sessionId, { dir: config.workingDirectory, limit: 1 }) ?? [];
        const hasExistingSession = sessionMessages.length > 0;

        // Build XML task context block to prepend on the first turn of a new session only.
        // Description is markdown so it is wrapped in CDATA to preserve special characters.
        const taskContextXml = (!hasExistingSession && config.taskContext)
          ? [
            `<task>`,
            `  <title>${config.taskContext.title}</title>`,
            ...(config.taskContext.description
              ? [
                `  <description><![CDATA[`,
                config.taskContext.description,
                `  ]]></description>`,
              ]
              : []),
            `</task>`,
          ].join("\n")
          : undefined;

        const prompt = taskContextXml ? `${taskContextXml}\n\n${config.prompt}` : config.prompt;

        // Log the outbound query params so we can verify what Claude actually receives
        // (prompt + systemInstructions/appendSystemPrompt) — useful for diagnosing
        // context-loss regressions where task title/description goes missing.
        config.onRawMessage?.({
          type: "outbound",
          subtype: "query_params",
          prompt,
          systemInstructions: config.systemInstructions ?? null,
          taskContext: config.taskContext ?? null,
          sessionId: config.sessionId,
          hasExistingSession: !!hasExistingSession,
          workingDirectory: config.workingDirectory,
          model: config.model ?? null,
        });

        const query = sdk.query({
          prompt,
          options: {
            cwd: config.workingDirectory,
            additionalDirectories: [config.workingDirectory],
            abortController,
            includePartialMessages: true,
            ...(normalizeClaudeModel(config.model) ? { model: normalizeClaudeModel(config.model) } : {}),
            ...(hasExistingSession ? { resume: config.sessionId } : { sessionId: config.sessionId }),
            tools: { type: "preset", preset: "claude_code" },
            settingSources: ["project"],
            // DOCS: Tool search is enabled by default (ENABLE_TOOL_SEARCH is unset/true).
            // When active, ALL MCP tool definitions are withheld from Claude's context window —
            // Claude discovers them on demand via a search step. This means Claude never "sees"
            // mcp__railyin__* tools unless it thinks to search for them, which it won't for
            // domain-specific tools like decision_request.
            //
            // Fix: disable tool search so all tool definitions are loaded into context upfront.
            // Docs: "With fewer than ~10 tools, loading everything upfront is typically faster."
            // We have ~14 railyin tools — still small enough that this is the right trade-off.
            // Ref: https://code.claude.com/docs/en/agent-sdk/tool-search
            //
            // IMPORTANT: the `env` option replaces process.env entirely — always spread it as
            // the base or the Claude subprocess loses ANTHROPIC_API_KEY, HOME, PATH, etc.
            env: { ...process.env, ENABLE_TOOL_SEARCH: "false" },
            // DOCS: MCP tools require explicit permission before Claude can call them.
            // Without allowedTools, calls go through the permission flow (canUseTool callback).
            // Our canUseTool allows all non-Bash tools, so it works, but allowedTools is the
            // canonical approach and removes the callback overhead for MCP calls.
            // The wildcard "mcp__railyin__*" pre-approves every tool in our in-process server.
            // External MCP tools are also pre-approved here when enabledMcpTools is provided.
            // Ref: https://code.claude.com/docs/en/agent-sdk/mcp#allow-mcp-tools
            allowedTools: [
              "mcp__railyin__*",
              ...buildAllowedExternalMcpTools(config.externalMcpServers, config.enabledMcpTools),
            ],
            // SDK hooks format: Partial<Record<HookEvent, HookCallbackMatcher[]>>
            // HookEvent keys are PascalCase (e.g. 'PostToolUse', 'PreCompact'), NOT camelCase.
            // Each value must be an array of { hooks: HookCallback[] } objects.
            // Wrong format causes iX.initialize() to crash on fn.map() (function ≠ array),
            // which is swallowed by .catch(()=>{}) — preventing sdkMcpServers registration.
            hooks: {
              PreCompact: [{
                hooks: [async (_input: unknown) => {
                  emit({ type: "compaction_start" });
                  return {};
                }],
              }],
              PostCompact: [{
                hooks: [async (_input: unknown) => {
                  emit({ type: "compaction_done" });
                  return {};
                }],
              }],
              PostToolUse: [{
                hooks: [async () => {
                  // If the handler set a suspend payload, emit the event and stop the loop.
                  const payload = takePendingSuspend();
                  if (payload !== undefined) {
                    emit({ type: "decision_request", payload });
                    return { continue: false };
                  }
                  return {};
                }],
              }],
            },
            systemPrompt: config.systemInstructions
              ? { type: "preset", preset: "claude_code", append: config.systemInstructions }
              : { type: "preset", preset: "claude_code" },
            mcpServers: {
              railyin: toolServer,
              ...buildExternalMcpServers(config.externalMcpServers, config.enabledMcpTools),
            },
            canUseTool: async (
              toolName: string,
              input: Record<string, unknown>,
              options: { suggestions?: unknown; title?: string },
            ) => {
              if (toolName !== "Bash") {
                return buildAllowPermissionResult(input);
              }
              const command = extractShellCommand(toolName, input, options.title);
              const shellState = this.shellApprovalRepo.getState(config.shellScope);
              if (shellState.shellAutoApprove) {
                return buildAllowPermissionResult(input);
              }
              const unapproved = getUnapprovedShellBinaries(command, shellState.approvedCommands);
              if (unapproved.length === 0) {
                return buildAllowPermissionResult(input);
              }
              emit({
                type: "shell_approval",
                command,
                executionId: config.executionId,
              });
              this.leases.touch(config.sessionId, "waiting_user");
              const resumeInput = await config.waitForResume({
                type: "shell_approval",
                command,
              });
              this.leases.touch(config.sessionId, "running");
              if (resumeInput.type === "shell_approval" && resumeInput.decision === "approve_all") {
                this.shellApprovalRepo.appendApprovedCommands(config.shellScope, unapproved);
              }
              return permissionDecisionToResult(resumeInput, input, options.suggestions);
            },
            onElicitation: async (request: { message: string; requestedSchema?: Record<string, unknown> }) => {
              const payload = buildAskUserPayload(request.message, request.requestedSchema);
              emit({ type: "ask_user", payload });
              this.leases.touch(config.sessionId, "waiting_user");
              const resumeInput = await config.waitForResume({ type: "ask_user", payload });
              this.leases.touch(config.sessionId, "running");
              if (resumeInput.type !== "ask_user") {
                return { action: "decline" };
              }
              return {
                action: "accept",
                content: { response: resumeInput.content },
              };
            },
          },
        });

        this.trackExecutionLease(config.executionId, config.sessionId);
        this.leases.touch(config.sessionId, "running");
        this.activeQueries.set(config.executionId, {
          interrupt: query.interrupt ? () => query.interrupt!() : undefined,
          close: query.close ? () => query.close!() : undefined,
          sessionId: config.sessionId,
        });

        for await (const message of query) {
          this.leases.touch(config.sessionId, "running");
          config.onRawMessage?.(message as Record<string, unknown>);
          // DOCS: The first message from the SDK is always type="system" subtype="init".
          // It includes mcp_servers[].status for each configured server ("connected" | "failed").
          // A "failed" status means the MCP server process didn't start or the in-process
          // bridge failed — this is the definitive signal that railyin tools won't be available.
          // Ref: https://code.claude.com/docs/en/agent-sdk/mcp#error-handling
          for (const event of translateClaudeMessage(message as { type: string }, {
            toolMetaByCallId: config.toolMetaByCallId,
            worktreePath: config.workingDirectory,
            fileStateCache: config.fileStateCache,
          })) {
            emit(event);
          }
        }

      } catch (err) {
        if (!abortController.signal.aborted) {
          emit({
            type: "error",
            message: err instanceof Error ? err.message : String(err),
            fatal: true,
          });
        }
      } finally {
        this.activeQueries.get(config.executionId)?.close?.();
        this.activeQueries.delete(config.executionId);
        this.untrackExecutionLease(config.executionId);
        this.leases.setState(config.sessionId, "idle");
        this.leases.touch(config.sessionId, "idle");
        done = true;
        wake();
      }
    })();

    while (!done || queue.length > 0) {
      while (queue.length > 0) {
        yield queue.shift()!;
      }
      if (done) break;
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  }

  async cancel(executionId: number): Promise<void> {
    const query = this.activeQueries.get(executionId);
    await query?.interrupt?.().catch(() => { });
    query?.close?.();
    this.activeQueries.delete(executionId);
    this.untrackExecutionLease(executionId);
  }

  touchExecutionLease(executionId: number, state: EngineLeaseState = "running"): void {
    const sessionId = this.executionToSession.get(executionId);
    if (!sessionId) return;
    this.leases.touch(sessionId, state);
  }

  async shutdownAll(options: EngineShutdownOptions = { reason: "app-exit", deadlineMs: 3_000 }): Promise<void> {
    await this.leases.shutdownAll(async (leaseKey) => {
      await this.closeLeaseExecutions(leaseKey, "engine-shutdown");
    }, options);
  }

  async listCommands(workingDirectory: string): Promise<Array<{ name: string; description: string }>> {
    const sdk = await loadClaudeRuntime();
    const query = sdk.query({
      prompt: "List available slash commands.",
      options: {
        cwd: workingDirectory,
        permissionMode: "plan",
        tools: [],
        persistSession: false,
        onElicitation: async () => ({ action: "decline" }),
      },
    });

    try {
      const commands = await query.supportedCommands?.() ?? [];
      return commands.map((cmd) => ({
        name: String(cmd.name ?? ""),
        description: String(cmd.description ?? ""),
      }));
    } finally {
      await query.interrupt?.().catch(() => { });
      query.close?.();
    }
  }

  async listModels(workingDirectory: string): Promise<ClaudeSdkModelInfo[]> {
    if (!this._modelsFetch) {
      this._modelsFetch = this._fetchModels(workingDirectory);
    }
    return this._modelsFetch;
  }

  private async _fetchModels(workingDirectory: string): Promise<ClaudeSdkModelInfo[]> {
    const sdk = await loadClaudeRuntime();
    // A no-op onElicitation forces the SDK into bidirectional mode
    // (hasBidirectionalNeeds=true → isSingleUserTurn=false). Without it the
    // SDK closes stdin after the first result, tearing down the control channel
    // before supportedModels() can receive its response and throwing
    // "Query closed before response received".
    const query = sdk.query({
      prompt: "List available Claude models.",
      options: {
        cwd: workingDirectory,
        permissionMode: "plan",
        tools: [],
        persistSession: false,
        onElicitation: async () => ({ action: "decline" }),
      },
    });

    const TIMEOUT_MS = 10_000;
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined;

    try {
      const models = await Promise.race([
        query.supportedModels?.() ?? Promise.resolve([]),
        new Promise<never>((_, reject) => {
          timeoutHandle = setTimeout(
            () => reject(new Error(`ClaudeEngine.listModels timed out after ${TIMEOUT_MS / 1000}s`)),
            TIMEOUT_MS,
          );
        }),
      ]);
      return models.map((model) => {
        const modelRecord = model as Record<string, unknown>;
        const supportedEffortLevelsRaw = modelRecord.supportedEffortLevels;
        const defaultEffortLevelRaw = modelRecord.defaultEffortLevel;
        return ({
        value: String(model.value ?? model.id ?? ""),
        displayName: String(model.displayName ?? model.value ?? model.id ?? ""),
        description: typeof model.description === "string" ? model.description : undefined,
        supportsEffort: Boolean(model.supportsEffort),
        supportsAdaptiveThinking: Boolean(model.supportsAdaptiveThinking),
        supportedEffortLevels: Array.isArray(supportedEffortLevelsRaw)
          ? supportedEffortLevelsRaw.filter((entry: unknown) => typeof entry === "string")
          : undefined,
        defaultEffortLevel: typeof defaultEffortLevelRaw === "string"
          ? defaultEffortLevelRaw
          : undefined,
      });
      });
    } catch (err) {
      // Clear so the next call retries rather than reusing a rejected promise
      this._modelsFetch = null;
      throw err;
    } finally {
      clearTimeout(timeoutHandle);
      await query.interrupt?.().catch(() => { });
      query.close?.();
    }
  }

  private trackExecutionLease(executionId: number, sessionId: string): void {
    this.executionToSession.set(executionId, sessionId);
    let executions = this.leaseExecutions.get(sessionId);
    if (!executions) {
      executions = new Set<number>();
      this.leaseExecutions.set(sessionId, executions);
    }
    executions.add(executionId);
  }

  private untrackExecutionLease(executionId: number): void {
    const sessionId = this.executionToSession.get(executionId);
    if (!sessionId) return;
    this.executionToSession.delete(executionId);
    const executions = this.leaseExecutions.get(sessionId);
    if (!executions) return;
    executions.delete(executionId);
    if (executions.size === 0) {
      this.leaseExecutions.delete(sessionId);
      this.leases.setState(sessionId, "idle");
    }
  }

  private async closeLeaseExecutions(sessionId: string, reason: string): Promise<void> {
    const executions = this.leaseExecutions.get(sessionId);
    if (!executions || executions.size === 0) return;

    await Promise.all(
      [...executions].map(async (executionId) => {
        const query = this.activeQueries.get(executionId);
        await query?.interrupt?.().catch(() => { });
        query?.close?.();
        this.activeQueries.delete(executionId);
        this.untrackExecutionLease(executionId);
      }),
    );
  }
}

export function createDefaultClaudeSdkAdapter(shellApprovalRepo?: ShellApprovalRepository): ClaudeSdkAdapter {
  return new DefaultClaudeSdkAdapter(shellApprovalRepo);
}
