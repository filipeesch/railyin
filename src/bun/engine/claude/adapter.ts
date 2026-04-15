import { createHash } from "crypto";
import type { CommonToolContext, EngineEvent, EngineResumeInput } from "../types.ts";
import { buildClaudeToolServer } from "./tools.ts";
import { translateClaudeMessage, type ToolMetadata } from "./events.ts";
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
  onRawMessage?: (message: Record<string, unknown>) => void;
  toolMetaByCallId?: Map<string, ToolMetadata>;
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

const CLI_CACHE_DIR = "claude-cli";
const CLI_FILE_NAME = "cli.js";
const NPM_PACKAGE_NAME = "@anthropic-ai/claude-agent-sdk";
const NPM_REGISTRY_URL = "https://registry.npmjs.org";

function getDataDir(): string {
  const { join } = require("path") as typeof import("path");
  return process.env.RAILYN_DATA_DIR ?? join(process.env.HOME ?? "~", ".railyn");
}

/**
 * Extract a single file from a gzipped tarball buffer and write it to disk.
 */
async function extractFileFromTarball(tarballBuffer: Buffer, entryName: string, destPath: string): Promise<void> {
  const { Readable } = require("stream") as typeof import("stream");
  const { createGunzip } = require("zlib") as typeof import("zlib");

  // We parse the tar format manually to avoid needing a tar dependency.
  // tar files consist of 512-byte header blocks followed by file data blocks.
  const gunzip = createGunzip();
  const chunks: Buffer[] = [];

  await new Promise<void>((resolve, reject) => {
    const input = Readable.from(tarballBuffer);
    const decompressed = input.pipe(gunzip);
    decompressed.on("data", (chunk: Buffer) => chunks.push(chunk));
    decompressed.on("end", () => resolve());
    decompressed.on("error", (err: Error) => reject(err));
  });

  const data = Buffer.concat(chunks);
  let offset = 0;
  let found = false;

  while (offset < data.length - 512) {
    const header = data.subarray(offset, offset + 512);
    const nameEnd = header.indexOf(0);
    const name = header.subarray(0, Math.min(nameEnd >= 0 ? nameEnd : 100, 100)).toString("utf-8");

    if (!name || name.trim() === "") break;

    const sizeStr = header.subarray(124, 136).toString("utf-8").trim();
    const size = parseInt(sizeStr, 8) || 0;

    if (name === entryName) {
      const fileData = data.subarray(offset + 512, offset + 512 + size);
      const { writeFileSync } = require("fs") as typeof import("fs");
      writeFileSync(destPath, fileData);
      found = true;
      break;
    }

    offset += 512 + Math.ceil(size / 512) * 512;
  }

  if (!found) {
    throw new Error(`Entry "${entryName}" not found in tarball`);
  }
}

/**
 * Returns the path to the cached Claude CLI script, downloading it from npm if needed.
 *
 * Resolution order:
 * 1. Cached cli.js at ~/.railyn/claude-cli/cli.js — from a previous download
 * 2. Download @anthropic-ai/claude-agent-sdk from npm, extract cli.js, cache
 */
async function ensureClaudeCliJs(): Promise<string> {
  const { join } = require("path") as typeof import("path");
  const { existsSync, mkdirSync } = require("fs") as typeof import("fs");

  const dataDir = getDataDir();
  const cacheDir = join(dataDir, CLI_CACHE_DIR);
  const cliPath = join(cacheDir, CLI_FILE_NAME);

  // Already downloaded — use the cached cli.js.
  if (existsSync(cliPath)) {
    console.log("[claude] Using cached cli.js:", cliPath);
    return cliPath;
  }

  // Download from npm registry.
  console.log(`[claude] cli.js not found. Downloading ${NPM_PACKAGE_NAME} from npm...`);
  mkdirSync(cacheDir, { recursive: true });

  // 1. Fetch package metadata to get the tarball URL.
  const metaUrl = `${NPM_REGISTRY_URL}/${NPM_PACKAGE_NAME}/latest`;
  const metaRes = await fetch(metaUrl);
  if (!metaRes.ok) {
    throw new Error(`Failed to fetch Claude SDK package metadata from ${metaUrl}: ${metaRes.status} ${metaRes.statusText}`);
  }
  const meta = (await metaRes.json()) as { dist: { tarball: string } };
  const tarballUrl = meta.dist.tarball;
  console.log("[claude] Downloading tarball:", tarballUrl);

  // 2. Download the tarball.
  const tarballRes = await fetch(tarballUrl);
  if (!tarballRes.ok) {
    throw new Error(`Failed to download Claude SDK tarball from ${tarballUrl}: ${tarballRes.status} ${tarballRes.statusText}`);
  }
  const tarballBuffer = Buffer.from(await tarballRes.arrayBuffer());

  // 3. Extract cli.js from the tarball (npm tarballs use a package/ prefix).
  await extractFileFromTarball(tarballBuffer, `package/${CLI_FILE_NAME}`, cliPath);

  console.log("[claude] cli.js cached at:", cliPath);
  return cliPath;
}

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
        const [sdk, zod, cliPath] = await Promise.all([loadClaudeRuntime(), loadZodRuntime(), ensureClaudeCliJs()]);
        const toolServer = buildClaudeToolServer(sdk, zod.z, config.commonToolContext);
        const hasExistingSession = await sdk.getSessionInfo?.(config.sessionId, { dir: config.workingDirectory }).catch(() => undefined);
        const query = sdk.query({
          prompt: config.prompt,
          options: {
            cwd: config.workingDirectory,
            additionalDirectories: [config.workingDirectory],
            abortController,
            pathToClaudeCodeExecutable: cliPath,
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
          config.onRawMessage?.(message as Record<string, unknown>);
          for (const event of translateClaudeMessage(message as { type: string }, config.toolMetaByCallId)) {
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
    const [sdk, cliPath] = await Promise.all([loadClaudeRuntime(), ensureClaudeCliJs()]);
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
        pathToClaudeCodeExecutable: cliPath,
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
