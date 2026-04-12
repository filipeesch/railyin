#!/usr/bin/env bun
/**
 * run-ui-tests.ts — UI test orchestrator for Railyn.
 *
 * Dev mode  (no args):     build → start app → setup-test-env → keep running (Ctrl+C to stop)
 * Test mode (with target): build → start app → setup-test-env → bun test    → shutdown → exit
 *
 * Uses --test-mode (compile-time defines for debug + memory-db) and parses
 * DEBUG_PORT=N from stdout for dynamic port discovery — no env vars, no port files.
 *
 * Invoked via package.json scripts:
 *   bun run dev:test            → dev mode
 *   bun run test:ui             → test mode, full suite
 *   bun run test:ui:chat        → test mode, specific suite
 */

const PROJECT_DIR = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const testTarget = process.argv[2] as string | undefined;
const devMode = testTarget === undefined;
const MAX_WAIT_MS = 60_000;

// ─── Utilities ────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ─── App lifecycle ────────────────────────────────────────────────────────────

let appProc: ReturnType<typeof Bun.spawn> | null = null;
let bridgePort = 0;
let cleaningUp = false;

async function shutdown(): Promise<void> {
  if (cleaningUp) return;
  cleaningUp = true;
  process.stdout.write("\n→ Shutting down app...\n");
  if (bridgePort) {
    await fetch(`http://localhost:${bridgePort}/shutdown`, {
      signal: AbortSignal.timeout(2000),
    }).catch(() => {});
    await sleep(400);
  }
  try { appProc?.kill("SIGTERM"); } catch { /* ignore */ }
}

function shutdownAndExit(): void {
  shutdown().finally(() => process.exit(0));
}

process.on("SIGINT",  shutdownAndExit);
process.on("SIGTERM", shutdownAndExit);

// ─── Banner ───────────────────────────────────────────────────────────────────

const modeLabel = devMode
  ? "dev (keep running)"
  : `test: ${testTarget!.split("/").pop()}`;

console.log(`\n╔════════════════════════════════════════╗`);
console.log(`║  Railyn UI Test Orchestrator           ║`);
console.log(`║  ${modeLabel.padEnd(38)}║`);
console.log(`╚════════════════════════════════════════╝\n`);

// ─── 1. vite build ─────────────────────────────────────────────────────────────

process.stdout.write("→ Building (vite)...\n");
const build = Bun.spawnSync(["vite", "build"], {
  cwd: PROJECT_DIR,
  env: { ...process.env, RAILYN_CLI: "1" },
  stdout: "inherit",
  stderr: "inherit",
});
if (build.exitCode !== 0) {
  process.stderr.write("✗ vite build failed.\n");
  process.exit(1);
}

// ─── 2. Spawn app with --test-mode ────────────────────────────────────────────
// --test-mode bakes __RAILYN_FORCE_DEBUG__ + __RAILYN_FORCE_MEMORY_DB__ at compile time.
// Debug server binds to OS-assigned port 0 and announces DEBUG_PORT=N on stdout.

process.stdout.write("→ Starting app (--test-mode)...\n");
appProc = Bun.spawn(
  ["electrobun", "dev", "--watch", "--test-mode"],
  {
    cwd: PROJECT_DIR,
    env: { ...process.env, RAILYN_CLI: "1" },
    stdout: "pipe",
    stderr: "inherit",
  },
);

// ─── 3. Parse DEBUG_PORT=N from stdout ────────────────────────────────────────

process.stdout.write("→ Waiting for debug port");
const deadline = Date.now() + MAX_WAIT_MS;

// Read stdout chunks and scan for DEBUG_PORT=N
const reader = appProc.stdout!.getReader();
let buffer = "";

outer:
while (Date.now() < deadline) {
  const timeLeft = deadline - Date.now();
  const readPromise = reader.read();
  const timeoutPromise = sleep(Math.min(timeLeft, 1000)).then(() => ({ done: false, value: undefined }));

  const result = await Promise.race([readPromise, timeoutPromise]) as ReadableStreamReadResult<Uint8Array>;

  if (result.value) {
    const chunk = new TextDecoder().decode(result.value);
    buffer += chunk;
    // Check for DEBUG_PORT=N in accumulated output
    const match = buffer.match(/DEBUG_PORT=(\d+)/);
    if (match) {
      bridgePort = parseInt(match[1]!, 10);
      break outer;
    }
  }

  if (result.done) break;
  process.stdout.write(".");
}

// Release the reader so stdout keeps flowing (app stays alive)
try { reader.releaseLock(); } catch { /* ignore */ }

if (!bridgePort) {
  process.stderr.write(`\n✗ App did not announce DEBUG_PORT after ${MAX_WAIT_MS / 1000}s.\n`);
  if (buffer) process.stderr.write(`  stdout so far:\n${buffer.slice(-500)}\n`);
  await shutdown();
  process.exit(1);
}
console.log(` ✓ port ${bridgePort}`);

// ─── 4. Poll until bridge responds ────────────────────────────────────────────

process.stdout.write("→ Waiting for bridge");
while (Date.now() < deadline) {
  try {
    const r = await fetch(`http://localhost:${bridgePort}/`, {
      signal: AbortSignal.timeout(1000),
    });
    if (r.status < 500) { break; }
  } catch { /* not up yet */ }
  process.stdout.write(".");
  await sleep(500);
}
console.log(" ✓");

// ─── 5. Seed test environment ─────────────────────────────────────────────────

process.stdout.write("→ Seeding test environment (/setup-test-env)...\n");
const setupRes = await fetch(`http://localhost:${bridgePort}/setup-test-env`);
const setupData = await setupRes.json() as { taskId?: number; files?: string[]; __error?: string };
if (!setupRes.ok || setupData.__error) {
  process.stderr.write(`✗ /setup-test-env failed: ${setupData.__error ?? setupRes.status}\n`);
  await shutdown();
  process.exit(1);
}
console.log(`  taskId=${setupData.taskId} ✓`);

// ─── 6a. Dev mode: keep running ───────────────────────────────────────────────

if (devMode) {
  console.log(`\n✓ App ready.  Bridge: http://localhost:${bridgePort}  (--debug=${bridgePort})`);
  console.log("  Press Ctrl+C to stop.\n");
  await new Promise<never>(() => {});
}

// ─── 6b. Test mode: run tests then kill ───────────────────────────────────────

console.log(`\n→ Running tests: ${testTarget}\n`);
const testRun = Bun.spawnSync(
  ["bun", "test", testTarget!, "--timeout", "120000", "--", `--debug=${bridgePort}`],
  {
    cwd: PROJECT_DIR,
    stdout: "inherit",
    stderr: "inherit",
  },
);

await shutdown();

const exitCode = testRun.exitCode ?? 1;
console.log(exitCode === 0 ? "\n✓ All tests passed." : `\n✗ Tests failed (exit ${exitCode}).`);
process.exit(exitCode);
