export interface CopilotSdkSessionConfig {
  sessionId?: string;
  model?: string;
  tools?: unknown[];
  systemMessage?: { mode: "append"; content: string };
  onPermissionRequest?: (request: unknown, invocation: unknown) => unknown;
  workingDirectory: string;
}

export type CopilotSdkResumeSessionConfig = Omit<CopilotSdkSessionConfig, "sessionId">;

export type CopilotSdkEvent =
  | { type: "assistant.message_delta"; data: { deltaContent: string } }
  | { type: "assistant.message"; data: { content?: string } }
  | { type: "assistant.reasoning_delta"; data: { deltaContent: string } }
  | { type: "assistant.reasoning"; data: { content?: string } }
  | { type: "session.ask_user"; data: { payload: string } }
  | { type: "tool.execution_start"; data: { toolCallId: string; toolName: string; arguments?: unknown } }
  | { type: "tool.execution_complete"; data: { toolCallId: string; success: boolean; result?: { content?: string } } }
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
  /** Register a callback for setup progress (e.g. "Downloading engine..."). */
  onStatus(listener: (message: string) => void): () => void;
}

type LoadedCopilotClient = {
  start(): Promise<void>;
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

// Singleton client — lazily initialised, shared across all executions.
let _clientPromise: Promise<LoadedCopilotClient> | undefined;
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

function getClient(): Promise<LoadedCopilotClient> {
  if (!_clientPromise) {
    _clientPromise = (async () => {
      const binaryPath = await ensureCliBinary();
      emitStatus("Starting Copilot engine...");
      console.log("[copilot] Connecting to CLI:", binaryPath);
      const port = await getOrSpawnCliPort(binaryPath);
      console.log("[copilot] CLI port:", port);
      const mod = await import("@github/copilot-sdk");
      const client = new mod.CopilotClient({ cliUrl: `localhost:${port}` }) as LoadedCopilotClient;
      await client.start();
      return client;
    })();
  }
  return _clientPromise;
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
  constructor(private readonly session: LoadedCopilotSession) { }

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
    return this.session.disconnect();
  }
}

class DefaultCopilotSdkAdapter implements CopilotSdkAdapter {
  onStatus(listener: (message: string) => void): () => void {
    _statusListeners.add(listener);
    return () => { _statusListeners.delete(listener); };
  }

  async createSession(config: CopilotSdkSessionConfig & { sessionId: string }): Promise<CopilotSdkSession> {
    const client = await getClient();
    const session = await client.createSession(config);
    return new DefaultCopilotSdkSession(session);
  }

  async resumeSession(sessionId: string, config: CopilotSdkResumeSessionConfig): Promise<CopilotSdkSession> {
    const client = await getClient();
    const session = await client.resumeSession(sessionId, config);
    return new DefaultCopilotSdkSession(session);
  }

  abortSession(session: CopilotSdkSession): Promise<void> {
    return session.abort();
  }

  disconnectSession(session: CopilotSdkSession): Promise<void> {
    return session.disconnect();
  }

  async listModels(): Promise<CopilotSdkModelInfo[]> {
    const client = await getClient();
    await client.start();
    return (await client.listModels()) as CopilotSdkModelInfo[];
  }
}

export function createDefaultCopilotSdkAdapter(): CopilotSdkAdapter {
  return new DefaultCopilotSdkAdapter();
}
