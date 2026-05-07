import { LeaseRegistry } from "../lease-registry.ts";
import type { EngineLeaseState, EngineShutdownOptions } from "../types.ts";

export interface CopilotSdkSessionConfig {
  sessionId?: string;
  model?: string;
  tools?: unknown[];
  systemMessage?: { mode: "append"; content: string };
  onPermissionRequest?: (request: unknown, invocation: unknown) => unknown;
  workingDirectory?: string;
  streaming?: boolean;
}

export type CopilotSdkResumeSessionConfig = Omit<CopilotSdkSessionConfig, "sessionId">;

export interface CopilotSdkToolResultContentBlock {
  type: string;
  [key: string]: unknown;
}

export interface CopilotSdkToolResultPayload {
  content?: string;
  detailedContent?: string;
  contents?: CopilotSdkToolResultContentBlock[];
}

export type CopilotSdkEvent =
  | { type: "assistant.message_delta"; data: { deltaContent: string }; source?: string }
  | { type: "assistant.message"; data: { content?: string }; source?: string }
  | { type: "assistant.reasoning_delta"; data: { deltaContent: string }; source?: string }
  | { type: "assistant.reasoning"; data: { content?: string }; source?: string }
  | { type: "session.ask_user"; data: { payload: string } }
  | {
    type: "tool.execution_start";
    data: { toolCallId: string; toolName: string; arguments?: unknown; parentToolCallId?: string };
    source?: string;
  }
  | { type: "tool.execution_partial_result"; data: { toolCallId: string; partialOutput: string }; source?: string }
  | { type: "tool.execution_progress"; data: { toolCallId: string; progressMessage: string }; source?: string }
  | {
    type: "tool.execution_complete";
    data: {
      toolCallId: string;
      success: boolean;
      result?: CopilotSdkToolResultPayload;
      isUserRequested?: boolean;
    };
    source?: string;
  }
  | { type: "assistant.usage"; data: { inputTokens?: number; outputTokens?: number } }
  | { type: "session.task_complete" }
  | { type: "session.idle" }
  | { type: "session.error"; data: { message: string } }
  | { type: "session.compaction_start"; data?: { estimatedTokens?: number } }
  | { type: "session.compaction_complete"; data?: { success?: boolean; postCompactionTokens?: number } }
  | { type: string; data?: unknown };

export interface CopilotSdkModelInfo {
  id: string;
  name?: string;
  capabilities: {
    limits: { max_context_window_tokens: number };
    supports: { reasoningEffort?: boolean };
  };
}

export type CopilotSdkAttachment =
  | { type: "file"; path: string; displayName?: string }
  | { type: "directory"; path: string; displayName?: string }
  | {
    type: "selection";
    filePath: string;
    displayName: string;
    text: string;
    selection: {
      start: { line: number; character: number };
      end: { line: number; character: number };
    };
  }
  | { type: "blob"; data: string; mimeType: string; displayName?: string };

export interface CopilotSdkSession {
  send(input: { prompt: string; attachments?: CopilotSdkAttachment[] }): Promise<unknown>;
  on(listener: (event: CopilotSdkEvent) => void): () => void;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
  /** Trigger manual context compaction for this session. */
  compact(): Promise<void>;
}

export interface CopilotSdkAdapter {
  createSession(config: CopilotSdkSessionConfig & { sessionId: string }): Promise<CopilotSdkSession>;
  resumeSession(sessionId: string, config: CopilotSdkResumeSessionConfig): Promise<CopilotSdkSession>;
  abortSession(session: CopilotSdkSession): Promise<void>;
  disconnectSession(session: CopilotSdkSession): Promise<void>;
  listModels(): Promise<CopilotSdkModelInfo[]>;
  /** Ping the CLI process for the given session and return true if healthy, false if dead/unreachable. */
  pingClient(sessionId: string): Promise<boolean>;
  /** Release (evict) the CLI process associated with the given session, stopping it if idle. */
  releaseClient(sessionId: string): Promise<void>;
  /** Refresh lease activity timestamp for the given session. */
  touchLease(sessionId: string, state?: EngineLeaseState): void;
  /** Update lease state without resetting activity timeout. */
  setLeaseState(sessionId: string, state: EngineLeaseState): void;
  /** Gracefully close all active leases for app-level shutdown. */
  shutdownAll(options?: EngineShutdownOptions): Promise<void>;
  /** Register a callback for setup progress (e.g. "Downloading engine..."). */
  onStatus(listener: (message: string) => void): () => void;
  /** Register a callback to be awaited before a pool entry is evicted. Returns unsubscribe function. */
  onBeforeEvict(sessionId: string, cb: () => Promise<void>): () => void;
}

type LoadedCopilotClient = {
  start(): Promise<void>;
  stop(): Promise<unknown>;
  ping(message?: string): Promise<unknown>;
  listModels(): Promise<unknown[]>;
  createSession(config: CopilotSdkSessionConfig & { sessionId: string }): Promise<LoadedCopilotSession>;
  resumeSession(sessionId: string, config: CopilotSdkResumeSessionConfig): Promise<LoadedCopilotSession>;
};

type LoadedCopilotSession = {
  send(input: { prompt: string; attachments?: CopilotSdkAttachment[] }): Promise<unknown>;
  on(listener: (event: unknown) => void): () => void;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
  rpc: {
    compaction: {
      compact(): Promise<unknown>;
    };
  };
};

// Shared singleton — used only for listModels(), reuses an existing CLI via port file.
let _sharedClientPromise: Promise<LoadedCopilotClient> | undefined;

// Per-task CLI pool — each session gets its own isolated CLI process.
type PoolEntry = {
  clientPromise: Promise<LoadedCopilotClient>;
  /** Number of SDK sessions currently active on this pool entry. Eviction is suppressed while > 0. */
  activeSessions: number;
};

const POOL_IDLE_TIMEOUT_MS = Number(process.env.RAILYN_ENGINE_IDLE_TIMEOUT_MS ?? 10 * 60 * 1000);

const PORT_FILE_NAME = "copilot-cli.port";

// npm package name pattern: @github/copilot-{platform}-{arch}
const NPM_PACKAGE_NAME = `@github/copilot-${process.platform}-${process.arch}`;

/**
 * Resolves the Copilot CLI binary path from the platform-specific optional npm package
 * (@github/copilot-{platform}-{arch}) that ships as a dependency of @github/copilot-sdk.
 *
 * No download or caching needed — the binary is installed alongside the SDK package.
 */
async function resolveCliBinary(): Promise<string> {
  const { fileURLToPath } = require("url") as typeof import("url");
  try {
    const resolved = import.meta.resolve(NPM_PACKAGE_NAME);
    const binaryPath = fileURLToPath(resolved);
    console.log(`[copilot] Using CLI binary from npm package: ${binaryPath}`);
    return binaryPath;
  } catch (err) {
    throw new Error(
      `Copilot CLI binary not found. The package ${NPM_PACKAGE_NAME} is not installed. ` +
      `Run 'bun install' to install it. (${err})`,
    );
  }
}

/** Try to connect to an already-running CLI at the given port. Returns true if alive. */
async function isPortAlive(port: number): Promise<boolean> {
  const { createConnection } = require("net") as typeof import("net");
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: "localhost" });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

/** Spawn a fresh CLI process and return the port it's listening on. */
function spawnCliAndGetPort(binaryPath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const { spawn } = require("child_process") as typeof import("child_process");
    const proc = spawn(binaryPath, ["--headless", "--no-auto-update", "--log-level", "debug", "--port", "0"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    proc.stdout?.on("data", (data: Buffer) => {
      stdout += data.toString();
      const match = stdout.match(/listening on port (\d+)/i);
      if (match) resolve(parseInt(match[1], 10));
    });
    proc.stderr?.on("data", (data: Buffer) => {
      console.error("[copilot] CLI stderr:", data.toString().trimEnd());
    });
    proc.on("error", (err: Error) => reject(err));
    proc.on("exit", (code: number | null) => {
      reject(new Error(`Copilot CLI exited with code ${code}`));
    });
  });
}

/**
 * Returns the port of a running Copilot CLI, reusing an existing instance if one
 * is already running (shared across multiple Railyin instances or the dev server).
 */
async function getOrSpawnCliPort(binaryPath: string): Promise<number> {
  const { join } = require("path") as typeof import("path");
  const { readFileSync, writeFileSync } = require("fs") as typeof import("fs");
  const { getTmpDir } = require("../../utils/platform.ts") as typeof import("../../utils/platform.ts");
  const portFile = join(getTmpDir(), PORT_FILE_NAME);

  // Try to reuse an existing instance.
  try {
    const existing = parseInt(readFileSync(portFile, "utf-8").trim(), 10);
    if (!isNaN(existing) && await isPortAlive(existing)) {
      console.log("[copilot] Reusing existing CLI on port:", existing);
      return existing;
    }
  } catch {
    // Port file absent or unreadable — fall through to spawn.
  }

  // Spawn a new instance and persist the port.
  const port = await spawnCliAndGetPort(binaryPath);
  writeFileSync(portFile, String(port), "utf-8");
  return port;
}

function getSharedClient(): Promise<LoadedCopilotClient> {
  if (!_sharedClientPromise) {
    _sharedClientPromise = (async () => {
      const binaryPath = await resolveCliBinary();
      console.log("[copilot] Connecting to shared CLI:", binaryPath);
      const port = await getOrSpawnCliPort(binaryPath);
      console.log("[copilot] Shared CLI port:", port);
      const mod = await import("@github/copilot-sdk");
      const client = new mod.CopilotClient({ cliUrl: `localhost:${port}` }) as LoadedCopilotClient;
      await client.start();
      return client;
    })().catch((err) => {
      // Reset singleton so the next call retries from scratch instead of
      // returning the same rejected promise forever.
      _sharedClientPromise = undefined;
      console.error("[copilot] Failed to start shared CLI client:", err instanceof Error ? err.stack ?? err.message : err);
      throw err;
    });
  }
  return _sharedClientPromise;
}


/**
 * Derive a deterministic Copilot SDK session ID from a Railyin task ID.
 *
 * Using a fixed, predictable ID means:
 * - No in-memory map needed.
 * - Context survives app restarts — resumeSession() always knows the right ID.
 * - A task always has exactly one persistent Copilot session.
 */
export function copilotSessionIdForTask(taskId: number): string {
  return `railyin-task-${taskId}`;
}

export function copilotSessionIdForConversation(taskId: number | null, conversationId: number): string {
  return taskId != null
    ? copilotSessionIdForTask(taskId)
    : `railyin-conversation-${conversationId}`;
}

class DefaultCopilotSdkSession implements CopilotSdkSession {
  constructor(
    private readonly session: LoadedCopilotSession,
    private readonly onDisconnect: () => void,
  ) { }

  send(input: { prompt: string; attachments?: CopilotSdkAttachment[] }): Promise<unknown> {
    return this.session.send(input);
  }

  on(listener: (event: CopilotSdkEvent) => void): () => void {
    return this.session.on((event: unknown) => listener(event as CopilotSdkEvent));
  }

  abort(): Promise<void> {
    return this.session.abort();
  }

  async compact(): Promise<void> {
    await this.session.rpc.compaction.compact();
  }

  disconnect(): Promise<void> {
    this.onDisconnect();
    return this.session.disconnect();
  }
}

export class DefaultCopilotSdkAdapter implements CopilotSdkAdapter {
  private readonly taskCliPool = new Map<string, PoolEntry>();
  private readonly statusListeners = new Set<(message: string) => void>();
  private readonly beforeEvictListeners = new Map<string, Set<() => Promise<void>>>();
  private readonly leaseRegistry: LeaseRegistry;

  constructor(leaseRegistry?: LeaseRegistry, poolIdleTimeoutMs = POOL_IDLE_TIMEOUT_MS, private readonly evictDeadlineMs = 5_000) {
    this.leaseRegistry = leaseRegistry ?? new LeaseRegistry(
      "copilot",
      poolIdleTimeoutMs,
      async (leaseKey) => {
        const entry = this.taskCliPool.get(leaseKey);
        if (entry && entry.activeSessions > 0) {
          this.leaseRegistry.touch(leaseKey, "running");
          return;
        }
        await this.evictPoolEntry(leaseKey);
      },
    );
  }

  private makeDisconnectCallback(sessionId: string): () => void {
    return () => {
      const entry = this.taskCliPool.get(sessionId);
      if (entry && entry.activeSessions > 0) {
        entry.activeSessions--;
        if (entry.activeSessions === 0) this.leaseRegistry.setState(sessionId, "idle");
      }
    };
  }

  private async evictPoolEntry(sessionId: string): Promise<void> {
    const callbacks = this.beforeEvictListeners.get(sessionId);
    if (callbacks && callbacks.size > 0) {
      let deadlineExceeded = false;
      const deadlineTimer = new Promise<void>((resolve) =>
        setTimeout(() => { deadlineExceeded = true; resolve(); }, this.evictDeadlineMs)
      );
      await Promise.race([
        Promise.all([...callbacks].map((cb) => cb())).catch(() => {}),
        deadlineTimer,
      ]);
      if (deadlineExceeded) {
        console.warn(`[copilot] onBeforeEvict deadline exceeded for session ${sessionId}`);
      }
    }
    const entry = this.taskCliPool.get(sessionId);
    if (!entry) return;
    this.taskCliPool.delete(sessionId);
    try {
      const client = await entry.clientPromise;
      await client.stop();
    } catch { /* ignore errors during cleanup */ }
  }

  private async getOrCreatePoolEntry(sessionId: string): Promise<LoadedCopilotClient> {
    const existing = this.taskCliPool.get(sessionId);
    if (existing) {
      this.leaseRegistry.touch(sessionId, "running");
      return existing.clientPromise;
    }

    const clientPromise: Promise<LoadedCopilotClient> = (async () => {
      const binaryPath = await resolveCliBinary();
      for (const listener of this.statusListeners) listener("Starting Copilot engine...");
      console.log(`[copilot] Spawning dedicated CLI for session ${sessionId}`);
      const port = await spawnCliAndGetPort(binaryPath);
      console.log(`[copilot] Session ${sessionId} CLI port:`, port);
      const mod = await import("@github/copilot-sdk");
      const client = new mod.CopilotClient({ cliUrl: `localhost:${port}` }) as LoadedCopilotClient;
      await client.start();
      return client;
    })();

    const entry: PoolEntry = {
      clientPromise,
      activeSessions: 0,
    };
    this.taskCliPool.set(sessionId, entry);
    this.leaseRegistry.touch(sessionId, "running");
    // Remove entry on spawn failure so the next call retries cleanly
    clientPromise.catch(() => {
      this.taskCliPool.delete(sessionId);
      this.leaseRegistry.release(sessionId);
    });
    return clientPromise;
  }

  onStatus(listener: (message: string) => void): () => void {
    this.statusListeners.add(listener);
    return () => { this.statusListeners.delete(listener); };
  }

  /** Register a callback to be awaited before a pool entry is evicted. Returns unsubscribe function. */
  onBeforeEvict(sessionId: string, cb: () => Promise<void>): () => void {
    if (!this.beforeEvictListeners.has(sessionId)) {
      this.beforeEvictListeners.set(sessionId, new Set());
    }
    const callbacks = this.beforeEvictListeners.get(sessionId)!;
    callbacks.add(cb);
    return () => callbacks.delete(cb);
  }

  async createSession(config: CopilotSdkSessionConfig & { sessionId: string }): Promise<CopilotSdkSession> {
    const client = await this.getOrCreatePoolEntry(config.sessionId);
    const entry = this.taskCliPool.get(config.sessionId);
    if (entry) entry.activeSessions++;
    this.leaseRegistry.touch(config.sessionId, "running");
    const session = await client.createSession(config);
    return new DefaultCopilotSdkSession(session, this.makeDisconnectCallback(config.sessionId));
  }

  async resumeSession(sessionId: string, config: CopilotSdkResumeSessionConfig): Promise<CopilotSdkSession> {
    const client = await this.getOrCreatePoolEntry(sessionId);
    const entry = this.taskCliPool.get(sessionId);
    if (entry) entry.activeSessions++;
    this.leaseRegistry.touch(sessionId, "running");
    const session = await client.resumeSession(sessionId, config);
    return new DefaultCopilotSdkSession(session, this.makeDisconnectCallback(sessionId));
  }

  abortSession(session: CopilotSdkSession): Promise<void> {
    return session.abort();
  }

  disconnectSession(session: CopilotSdkSession): Promise<void> {
    return session.disconnect();
  }

  async pingClient(sessionId: string): Promise<boolean> {
    const entry = this.taskCliPool.get(sessionId);
    if (!entry) return false;
    let timedOut = false;
    try {
      const client = await entry.clientPromise;
      await Promise.race([
        client.ping(),
        new Promise<never>((_, reject) =>
          setTimeout(() => { timedOut = true; reject(new Error("ping timeout")); }, 5_000)
        ),
      ]);
      return true;
    } catch {
      // A timeout means the CLI is alive but busy with a long API call — not a crash.
      // A connection error (ECONNREFUSED/ECONNRESET) means the CLI process is dead.
      return timedOut;
    }
  }

  async releaseClient(sessionId: string): Promise<void> {
    this.leaseRegistry.release(sessionId, "manual");
    await this.evictPoolEntry(sessionId);
  }

  touchLease(sessionId: string, state: EngineLeaseState = "running"): void {
    this.leaseRegistry.touch(sessionId, state);
  }

  setLeaseState(sessionId: string, state: EngineLeaseState): void {
    this.leaseRegistry.setState(sessionId, state);
  }

  async shutdownAll(options: EngineShutdownOptions = { reason: "app-exit", deadlineMs: 3_000 }): Promise<void> {
    await this.leaseRegistry.shutdownAll(async (leaseKey) => {
      await this.evictPoolEntry(leaseKey);
    }, options);
  }

  async listModels(): Promise<CopilotSdkModelInfo[]> {
    const LIST_MODELS_TIMEOUT_MS = 6_000;
    let client: LoadedCopilotClient;
    try {
      client = await Promise.race([
        getSharedClient(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Copilot CLI did not start within ${LIST_MODELS_TIMEOUT_MS / 1000}s — check that the CLI binary is installed and the port is reachable`)), LIST_MODELS_TIMEOUT_MS),
        ),
      ]);
    } catch (err) {
      console.error("[copilot] getSharedClient timed out or failed:", err instanceof Error ? err.message : err);
      throw err;
    }
    await client.start();
    return (await client.listModels()) as CopilotSdkModelInfo[];
  }
}

export function createDefaultCopilotSdkAdapter(leaseRegistry?: LeaseRegistry): CopilotSdkAdapter {
  return new DefaultCopilotSdkAdapter(leaseRegistry);
}
