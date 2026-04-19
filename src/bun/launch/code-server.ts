import * as path from "path";
import * as net from "net";
import { spawn, type ChildProcess } from "child_process";

type CodeServerStatus = "starting" | "ready" | "error";

interface CodeServerEntry {
  pid: number;
  port: number;
  status: CodeServerStatus;
  proc: ChildProcess;
}

const registry = new Map<number, CodeServerEntry>();

const VSIX_PATH = path.join(import.meta.dir, "../../extensions/railyin-ref/railyin-ref.vsix");

async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port, "127.0.0.1");
  });
}

async function findAvailablePort(base = 3100, maxAttempts = 10): Promise<number> {
  for (let i = 0; i < maxAttempts; i++) {
    const port = base + i;
    if (await isPortAvailable(port)) return port;
  }
  throw new Error(`No available port found in range ${base}–${base + maxAttempts - 1}`);
}

async function resolveCodeServerBinary(): Promise<string> {
  // Prefer local node_modules/.bin/code-server (installed as devDependency)
  const localBin = path.join(import.meta.dir, "../../../node_modules/.bin/code-server");
  const localFile = Bun.file(localBin);
  if (await localFile.exists()) return localBin;

  // Try system PATH
  const which = Bun.spawnSync(["which", "code-server"], { env: process.env as Record<string, string> });
  if (which.exitCode === 0) {
    return which.stdout.toString().trim();
  }

  // Fall back to npx (will download on first use)
  return "npx";
}

async function pollUntilReady(port: number, timeoutMs = 60_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
      if (res.status < 500) return;
    } catch {
      // not ready yet
    }
    await Bun.sleep(500);
  }
  throw new Error(`code-server on port ${port} did not become ready within ${timeoutMs}ms`);
}

export async function startCodeServer(
  taskId: number,
  worktreePath: string,
  railynApiPort: number,
): Promise<{ port: number }> {
  const existing = registry.get(taskId);
  if (existing && existing.status === "ready") {
    return { port: existing.port };
  }

  const port = await findAvailablePort(3100);
  const binary = await resolveCodeServerBinary();

  const args =
    binary === "npx"
      ? [
          "npx",
          "--yes",
          "code-server",
          `--port=${port}`,
          "--auth=none",
          "--disable-telemetry",
          worktreePath,
        ]
      : [
          binary,
          `--port=${port}`,
          "--auth=none",
          "--disable-telemetry",
          worktreePath,
        ];

  // Add extension install if vsix exists
  try {
    const vsixFile = Bun.file(VSIX_PATH);
    if (await vsixFile.exists()) {
      args.push(`--install-extension=${VSIX_PATH}`);
    }
  } catch {
    // vsix not built yet — continue without it
  }

  const proc = spawn(args[0], args.slice(1), {
    cwd: worktreePath,
    env: {
      ...process.env,
      RAILYIN_TASK_ID: String(taskId),
      RAILYIN_API_PORT: String(railynApiPort),
    },
    stdio: ["ignore", "pipe", "pipe"],
    detached: false,
  });

  const entry: CodeServerEntry = {
    pid: proc.pid!,
    port,
    status: "starting",
    proc,
  };
  registry.set(taskId, entry);

  proc.on("error", (err) => {
    console.error(`[code-server] task ${taskId} process error:`, err.message);
    entry.status = "error";
  });

  proc.stderr?.on("data", (data: Buffer) => {
    console.log(`[code-server:${taskId}] ${data.toString().trim()}`);
  });

  try {
    await pollUntilReady(port);
    entry.status = "ready";
  } catch (err) {
    entry.status = "error";
    throw err;
  }

  return { port };
}

export function stopCodeServer(taskId: number): boolean {
  const entry = registry.get(taskId);
  if (!entry) return false;
  try {
    entry.proc.kill("SIGTERM");
  } catch {
    // already dead
  }
  registry.delete(taskId);
  return true;
}

export function stopAllCodeServers(): void {
  for (const [taskId, entry] of registry) {
    try {
      entry.proc.kill("SIGTERM");
    } catch {
      // already dead
    }
    registry.delete(taskId);
  }
}

export function getCodeServerEntry(
  taskId: number,
): { port: number; status: CodeServerStatus } | null {
  const entry = registry.get(taskId);
  if (!entry) return null;
  return { port: entry.port, status: entry.status };
}
