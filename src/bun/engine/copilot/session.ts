export interface CopilotSdkSessionConfig {
  sessionId?: string;
  model?: string;
  tools?: unknown[];
  systemMessage?: { mode: "append"; content: string };
  onPermissionRequest?: (request: unknown, invocation: unknown) => unknown;
  workingDirectory: string;
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
  | { type: string; data?: unknown };

export interface CopilotSdkModelInfo {
  id: string;
  name?: string;
  capabilities: {
    limits: { max_context_window_tokens: number };
    supports: { reasoningEffort?: boolean };
  };
}

export interface CopilotSdkSession {
  send(input: { prompt: string }): Promise<unknown>;
  on(listener: (event: CopilotSdkEvent) => void): () => void;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
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
  touchLease(sessionId: string, state?: import("../types.ts").EngineLeaseState): void;
  /** Update lease state without resetting activity timeout. */
  setLeaseState(sessionId: string, state: import("../types.ts").EngineLeaseState): void;
  /** Gracefully close all active leases for app-level shutdown. */
  shutdownAll(options?: import("../types.ts").EngineShutdownOptions): Promise<void>;
  /** Register a callback for setup progress (e.g. "Downloading engine..."). */
  onStatus(listener: (message: string) => void): () => void;
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
  send(input: { prompt: string }): Promise<unknown>;
  on(listener: (event: unknown) => void): () => void;
  abort(): Promise<void>;
  disconnect(): Promise<void>;
};

// Shared singleton — used only for listModels(), reuses an existing CLI via port file.
let _sharedClientPromise: Promise<LoadedCopilotClient> | undefined;

// Per-task CLI pool — each session gets its own isolated CLI process.
type PoolEntry = {
  clientPromise: Promise<LoadedCopilotClient>;
  /** Number of SDK sessions currently active on this pool entry. Eviction is suppressed while > 0. */
  activeSessions: number;
};
const _taskCliPool = new Map<string, PoolEntry>();
import { LeaseRegistry } from "../lease-registry.ts";
import type { EngineLeaseState, EngineShutdownOptions } from "../types.ts";

const POOL_IDLE_TIMEOUT_MS = Number(process.env.RAILYN_ENGINE_IDLE_TIMEOUT_MS ?? 10 * 60 * 1000);
const _leaseRegistry = new LeaseRegistry(
  "copilot",
  POOL_IDLE_TIMEOUT_MS,
  async (leaseKey) => {
    await evictPoolEntry(leaseKey);
  },
);

// Status listeners waiting for progress updates from ensureCliBinary / getClient.
let _statusListeners: Set<(message: string) => void> = new Set();

function emitStatus(message: string): void {
  for (const listener of _statusListeners) listener(message);
}

const PORT_FILE_NAME = "copilot-cli.port";
const CLI_CACHE_DIR = "copilot-cli";
const CLI_BINARY_NAME = process.platform === "win32" ? "copilot.exe" : "copilot";

// npm package name pattern: @github/copilot-{platform}-{arch}
const NPM_PACKAGE_NAME = `@github/copilot-${process.platform}-${process.arch}`;
// npm registry URL for fetching the tarball metadata
const NPM_REGISTRY_URL = "https://registry.npmjs.org";

function getDataDir(): string {
  const { join } = require("path") as typeof import("path");
  return process.env.RAILYN_DATA_DIR ?? join(process.env.HOME ?? "~", ".railyn");
}

/**
 * Returns the path to the cached Copilot CLI binary, downloading it from npm if needed.
 *
 * Resolution order:
 * 1. Cached binary at ~/.railyn/copilot-cli/copilot — from a previous download
 * 2. Download @github/copilot-{platform}-{arch} from npm, extract, cache
 */
async function ensureCliBinary(): Promise<string> {
  const { join } = require("path") as typeof import("path");
  const { existsSync, mkdirSync, chmodSync } = require("fs") as typeof import("fs");

  const dataDir = getDataDir();
  const cacheDir = join(dataDir, CLI_CACHE_DIR);
  const binaryPath = join(cacheDir, CLI_BINARY_NAME);

  // Already downloaded — use the cached binary.
  if (existsSync(binaryPath)) {
    console.log("[copilot] Using cached CLI binary:", binaryPath);
    return binaryPath;
  }

  // Download from npm registry.
  emitStatus("Downloading Copilot engine...");
  console.log(`[copilot] CLI binary not found. Downloading ${NPM_PACKAGE_NAME} from npm...`);
  mkdirSync(cacheDir, { recursive: true });

  // 1. Fetch package metadata to get the tarball URL.
  const metaUrl = `${NPM_REGISTRY_URL}/${NPM_PACKAGE_NAME}/latest`;
  const metaRes = await fetch(metaUrl);
  if (!metaRes.ok) {
    throw new Error(`Failed to fetch Copilot CLI package metadata from ${metaUrl}: ${metaRes.status} ${metaRes.statusText}`);
  }
  const meta = (await metaRes.json()) as { dist: { tarball: string } };
  const tarballUrl = meta.dist.tarball;
  console.log("[copilot] Downloading tarball:", tarballUrl);

  // 2. Download the tarball.
  const tarballRes = await fetch(tarballUrl);
  if (!tarballRes.ok) {
    throw new Error(`Failed to download Copilot CLI tarball from ${tarballUrl}: ${tarballRes.status} ${tarballRes.statusText}`);
  }
  const tarballBuffer = Buffer.from(await tarballRes.arrayBuffer());

  // 3. Extract just the binary from the tarball (package/copilot).
  //    npm tarballs are gzipped and contain files under a `package/` prefix.
  emitStatus("Installing Copilot engine...");
  await extractBinaryFromTarball(tarballBuffer, `package/${CLI_BINARY_NAME}`, binaryPath);

  // 4. Make it executable (no-op on Windows).
  if (process.platform !== "win32") {
    chmodSync(binaryPath, 0o755);
  }

  console.log("[copilot] CLI binary cached at:", binaryPath);
  return binaryPath;
}

/**
 * Extract a single file from a gzipped tarball buffer and write it to disk.
 */
async function extractBinaryFromTarball(tarballBuffer: Buffer, entryName: string, destPath: string): Promise<void> {
  const { createWriteStream } = require("fs") as typeof import("fs");
  const { Readable } = require("stream") as typeof import("stream");
  const { createGunzip } = require("zlib") as typeof import("zlib");
  const { pipeline } = require("stream/promises") as typeof import("stream/promises");

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
    // tar header: first 100 bytes = filename (null-terminated)
    const header = data.subarray(offset, offset + 512);
    const nameEnd = header.indexOf(0);
    const name = header.subarray(0, Math.min(nameEnd >= 0 ? nameEnd : 100, 100)).toString("utf-8");

    if (!name || name.trim() === "") break; // end of archive

    // File size is at bytes 124-135 in octal
    const sizeStr = header.subarray(124, 136).toString("utf-8").trim();
    const size = parseInt(sizeStr, 8) || 0;

    if (name === entryName) {
      const fileData = data.subarray(offset + 512, offset + 512 + size);
      const { writeFileSync } = require("fs") as typeof import("fs");
      writeFileSync(destPath, fileData);
      found = true;
      break;
    }

    // Advance past header (512) + file data (rounded up to 512-byte blocks)
    offset += 512 + Math.ceil(size / 512) * 512;
  }

  if (!found) {
    throw new Error(`Entry "${entryName}" not found in tarball`);
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
  const { readFileSync, writeFileSync, mkdirSync } = require("fs") as typeof import("fs");
  const dataDir = getDataDir();
  const portFile = join(dataDir, PORT_FILE_NAME);

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
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(portFile, String(port), "utf-8");
  return port;
}

function getSharedClient(): Promise<LoadedCopilotClient> {
  if (!_sharedClientPromise) {
    _sharedClientPromise = (async () => {
      const binaryPath = await ensureCliBinary();
      emitStatus("Starting Copilot engine...");
      console.log("[copilot] Connecting to shared CLI:", binaryPath);
      const port = await getOrSpawnCliPort(binaryPath);
      console.log("[copilot] Shared CLI port:", port);
      const mod = await import("@github/copilot-sdk");
      const client = new mod.CopilotClient({ cliUrl: `localhost:${port}` }) as LoadedCopilotClient;
      await client.start();
      return client;
    })();
  }
  return _sharedClientPromise;
}

async function evictPoolEntry(sessionId: string): Promise<void> {
  const entry = _taskCliPool.get(sessionId);
  if (!entry) return;
  _taskCliPool.delete(sessionId);
  try {
    const client = await entry.clientPromise;
    await client.stop();
  } catch { /* ignore errors during cleanup */ }
}

async function getOrCreatePoolEntry(sessionId: string): Promise<LoadedCopilotClient> {
  const existing = _taskCliPool.get(sessionId);
  if (existing) {
    _leaseRegistry.touch(sessionId, "running");
    return existing.clientPromise;
  }

  const clientPromise: Promise<LoadedCopilotClient> = (async () => {
    const binaryPath = await ensureCliBinary();
    emitStatus("Starting Copilot engine...");
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
  _taskCliPool.set(sessionId, entry);
  _leaseRegistry.touch(sessionId, "running");
  // Remove entry on spawn failure so the next call retries cleanly
  clientPromise.catch(() => {
    _taskCliPool.delete(sessionId);
    _leaseRegistry.release(sessionId);
  });
  return clientPromise;
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

class DefaultCopilotSdkSession implements CopilotSdkSession {
  constructor(
    private readonly session: LoadedCopilotSession,
    private readonly sessionId: string,
  ) { }

  send(input: { prompt: string }): Promise<unknown> {
    return this.session.send(input);
  }

  on(listener: (event: CopilotSdkEvent) => void): () => void {
    return this.session.on((event: unknown) => listener(event as CopilotSdkEvent));
  }

  abort(): Promise<void> {
    return this.session.abort();
  }

  disconnect(): Promise<void> {
    const entry = _taskCliPool.get(this.sessionId);
    if (entry && entry.activeSessions > 0) {
      entry.activeSessions--;
      if (entry.activeSessions === 0) _leaseRegistry.setState(this.sessionId, "idle");
    }
    return this.session.disconnect();
  }
}

class DefaultCopilotSdkAdapter implements CopilotSdkAdapter {
  onStatus(listener: (message: string) => void): () => void {
    _statusListeners.add(listener);
    return () => { _statusListeners.delete(listener); };
  }

  async createSession(config: CopilotSdkSessionConfig & { sessionId: string }): Promise<CopilotSdkSession> {
    const client = await getOrCreatePoolEntry(config.sessionId);
    const entry = _taskCliPool.get(config.sessionId);
    if (entry) entry.activeSessions++;
    _leaseRegistry.touch(config.sessionId, "running");
    const session = await client.createSession(config);
    return new DefaultCopilotSdkSession(session, config.sessionId);
  }

  async resumeSession(sessionId: string, config: CopilotSdkResumeSessionConfig): Promise<CopilotSdkSession> {
    const client = await getOrCreatePoolEntry(sessionId);
    const entry = _taskCliPool.get(sessionId);
    if (entry) entry.activeSessions++;
    _leaseRegistry.touch(sessionId, "running");
    const session = await client.resumeSession(sessionId, config);
    return new DefaultCopilotSdkSession(session, sessionId);
  }

  abortSession(session: CopilotSdkSession): Promise<void> {
    return session.abort();
  }

  disconnectSession(session: CopilotSdkSession): Promise<void> {
    return session.disconnect();
  }

  async pingClient(sessionId: string): Promise<boolean> {
    const entry = _taskCliPool.get(sessionId);
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
    _leaseRegistry.release(sessionId, "manual");
    await evictPoolEntry(sessionId);
  }

  touchLease(sessionId: string, state: EngineLeaseState = "running"): void {
    _leaseRegistry.touch(sessionId, state);
  }

  setLeaseState(sessionId: string, state: EngineLeaseState): void {
    _leaseRegistry.setState(sessionId, state);
  }

  async shutdownAll(options: EngineShutdownOptions = { reason: "app-exit", deadlineMs: 3_000 }): Promise<void> {
    await _leaseRegistry.shutdownAll(async (leaseKey) => {
      await evictPoolEntry(leaseKey);
    }, options);
  }

  async listModels(): Promise<CopilotSdkModelInfo[]> {
    const client = await getSharedClient();
    await client.start();
    return (await client.listModels()) as CopilotSdkModelInfo[];
  }
}

export function createDefaultCopilotSdkAdapter(): CopilotSdkAdapter {
  return new DefaultCopilotSdkAdapter();
}
