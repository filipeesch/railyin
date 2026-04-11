import { createHash } from "crypto";
import type { CommonToolContext, EngineEvent, EngineResumeInput } from "../types.ts";
import { buildClaudeToolServer } from "./tools.ts";
import { translateClaudeMessage } from "./events.ts";
import { extractCommandBinaries } from "../../workflow/tools.ts";
import { appendApprovedCommands, getApprovedCommands } from "../../workflow/engine.ts";
import { getDb } from "../../db/index.ts";

export interface ClaudeSdkModelInfo {
  value: string;
  displayName: string;
  description?: string;
  supportsEffort?: boolean;
  supportsAdaptiveThinking?: boolean;
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
  taskId: number;
  prompt: string;
  workingDirectory: string;
  model?: string;
  systemInstructions?: string;
  signal?: AbortSignal;
  sessionId: string;
  commonToolContext: CommonToolContext;
  waitForResume: (request: ClaudeResumeRequest | ClaudeShellApprovalRequest) => Promise<EngineResumeInput>;
}

export interface ClaudeSdkAdapter {
  run(config: ClaudeRunConfig): AsyncIterable<EngineEvent>;
  cancel(executionId: number): Promise<void>;
  listModels(workingDirectory: string): Promise<ClaudeSdkModelInfo[]>;
}

interface ActiveClaudeQuery {
  interrupt?: () => Promise<void>;
  close?: () => void;
}

type ClaudeSdkRuntime = {
  query: (params: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<unknown> & {
    supportedModels?: () => Promise<Array<Record<string, unknown>>>;
    interrupt?: () => Promise<void>;
    close?: () => void;
  };
  getSessionInfo?: (sessionId: string, options?: { dir?: string }) => Promise<unknown>;
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

export function getUnapprovedShellBinaries(command: string, approvedCommands: string[]): string[] {
  return extractCommandBinaries(command)
    .filter((binary) => !approvedCommands.includes(binary));
}

function getApprovedShellState(taskId: number): { shellAutoApprove: boolean; approvedCommands: string[] } {
  const db = getDb();
  return {
    shellAutoApprove: db
      .query<{ shell_auto_approve: number }, [number]>("SELECT shell_auto_approve FROM tasks WHERE id = ?")
      .get(taskId)?.shell_auto_approve === 1,
    approvedCommands: getApprovedCommands(taskId),
  };
}

export function claudeSessionIdForTask(taskId: number): string {
  const hash = createHash("sha1").update(`railyin-claude-task-${taskId}`).digest("hex");
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
  private readonly activeQueries = new Map<number, ActiveClaudeQuery>();

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
        const toolServer = buildClaudeToolServer(sdk, zod.z, config.commonToolContext, emit);
        const hasExistingSession = await sdk.getSessionInfo?.(config.sessionId, { dir: config.workingDirectory }).catch(() => undefined);
        const query = sdk.query({
          prompt: config.prompt,
          options: {
            cwd: config.workingDirectory,
            abortController,
            ...(normalizeClaudeModel(config.model) ? { model: normalizeClaudeModel(config.model) } : {}),
            ...(hasExistingSession ? { resume: config.sessionId } : { sessionId: config.sessionId }),
            tools: { type: "preset", preset: "claude_code" },
            settingSources: ["project"],
            systemPrompt: config.systemInstructions
              ? { type: "preset", preset: "claude_code", append: config.systemInstructions }
              : { type: "preset", preset: "claude_code" },
            mcpServers: { railyin: toolServer },
            canUseTool: async (
              toolName: string,
              input: Record<string, unknown>,
              options: { suggestions?: unknown; title?: string },
            ) => {
              if (toolName !== "Bash") {
                return buildAllowPermissionResult(input);
              }
              const command = extractShellCommand(toolName, input, options.title);
              const taskShellState = getApprovedShellState(config.taskId);
              if (taskShellState.shellAutoApprove) {
                return buildAllowPermissionResult(input);
              }
              const unapproved = getUnapprovedShellBinaries(command, taskShellState.approvedCommands);
              if (unapproved.length === 0) {
                return buildAllowPermissionResult(input);
              }
              emit({
                type: "shell_approval",
                command,
                executionId: config.executionId,
              });
              const resumeInput = await config.waitForResume({
                type: "shell_approval",
                command,
              });
              if (resumeInput.type === "shell_approval" && resumeInput.decision === "approve_all") {
                appendApprovedCommands(config.taskId, unapproved);
              }
              return permissionDecisionToResult(resumeInput, input, options.suggestions);
            },
            onElicitation: async (request: { message: string; requestedSchema?: Record<string, unknown> }) => {
              const payload = buildAskUserPayload(request.message, request.requestedSchema);
              emit({ type: "ask_user", payload });
              const resumeInput = await config.waitForResume({ type: "ask_user", payload });
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

        this.activeQueries.set(config.executionId, {
          interrupt: query.interrupt ? () => query.interrupt!() : undefined,
          close: query.close ? () => query.close!() : undefined,
        });

        for await (const message of query) {
          for (const event of translateClaudeMessage(message as { type: string })) {
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
  }

  async listModels(workingDirectory: string): Promise<ClaudeSdkModelInfo[]> {
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
        onElicitation: async () => ({ action: "decline" }),
      },
    });

    try {
      const models = await query.supportedModels?.() ?? [];
      return models.map((model) => ({
        value: String(model.value ?? model.id ?? ""),
        displayName: String(model.displayName ?? model.value ?? model.id ?? ""),
        description: typeof model.description === "string" ? model.description : undefined,
        supportsEffort: Boolean(model.supportsEffort),
        supportsAdaptiveThinking: Boolean(model.supportsAdaptiveThinking),
      }));
    } finally {
      await query.interrupt?.().catch(() => { });
      query.close?.();
    }
  }
}

export function createDefaultClaudeSdkAdapter(): ClaudeSdkAdapter {
  return new DefaultClaudeSdkAdapter();
}
