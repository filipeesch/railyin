import { runMigrations, seedDefaultWorkspace } from "./db/migrations.ts";
import { getDb } from "./db/index.ts";
import { getWorkspaceRegistry, loadConfig } from "./config/index.ts";
import { StreamBatcher } from "./pipeline/batcher.ts";
import * as path from "path";
import type { ServerWebSocket } from "bun";
import { getPtySession, killAllPtySessions } from "./launch/pty.ts";
import { stopAllCodeServers } from "./launch/code-server.ts";

type WsData = { type: "push" } | { type: "pty"; sessionId: string };

// Track per-WS data listener functions so we can remove them on WS close
const ptyDataListeners = new WeakMap<ServerWebSocket<WsData>, (chunk: string) => void>();
const ptyExitListeners = new WeakMap<ServerWebSocket<WsData>, (code: number) => void>();

// ─── File logging (canary/production: no terminal to read) ───────────────────
{
  const os = await import("os");
  const fs = await import("fs");
  const path = await import("path");
  const logDir = path.join(os.homedir(), ".railyn", "logs");
  const logFile = path.join(logDir, "bun.log");
  fs.mkdirSync(logDir, { recursive: true });
  // Keep last 5 sessions — rotate on startup
  try { fs.renameSync(logFile, logFile + ".prev"); } catch { /* first run */ }
  const logStream = fs.createWriteStream(logFile, { flags: "a" });
  const origLog = console.log.bind(console);
  const origWarn = console.warn.bind(console);
  const origErr = console.error.bind(console);
  const write = (prefix: string, args: unknown[]) => {
    const line = `[${new Date().toISOString()}] ${prefix} ${args.map((a) => typeof a === "string" ? a : JSON.stringify(a, null, 2)).join(" ")}\n`;
    logStream.write(line);
  };
  console.log = (...a) => { origLog(...a); write("INFO ", a); };
  console.warn = (...a) => { origWarn(...a); write("WARN ", a); };
  console.error = (...a) => { origErr(...a); write("ERROR", a); };
  console.log("[railyin] Log started. pid:", process.pid, "execPath:", process.execPath, "PATH:", process.env.PATH);
}

// ─── Global error handlers ────────────────────────────────────────────────────
// These must be registered before any async work so unhandled rejections from
// SDK events, network I/O, or other background tasks are captured and logged
// rather than crashing the process silently.
process.on("unhandledRejection", (reason) => {
  console.error("[railyin] Unhandled rejection:", reason instanceof Error ? reason.stack ?? reason.message : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[railyin] Uncaught exception:", err instanceof Error ? err.stack ?? err.message : err);
});

// ─── CLI flags (must run before any module reads process.env) ─────────────────
// --memory-db     → uses an in-memory SQLite database (same as RAILYN_DB=:memory:)
declare const __RAILYN_FORCE_DEBUG__: boolean | undefined;
declare const __RAILYN_FORCE_MEMORY_DB__: boolean | undefined;

const argv = process.argv.slice(2);
if (__RAILYN_FORCE_DEBUG__) process.env.RAILYN_DEBUG = "1";
if (__RAILYN_FORCE_MEMORY_DB__) process.env.RAILYN_DB = ":memory:";
if (argv.includes("--memory-db")) process.env.RAILYN_DB = ":memory:";
import { workspaceHandlers } from "./handlers/workspace.ts";
import { boardHandlers } from "./handlers/boards.ts";
import { projectHandlers } from "./handlers/projects.ts";
import { taskHandlers } from "./handlers/tasks.ts";
import { conversationHandlers } from "./handlers/conversations.ts";
import { workflowHandlers } from "./handlers/workflow.ts";
import { launchHandlers } from "./handlers/launch.ts";
import { lspHandlers } from "./handlers/lsp.ts";
import { codeServerHandlers } from "./handlers/code-server.ts";
import { mcpHandlers } from "./handlers/mcp.ts";
import { mapTask } from "./db/mappers.ts";
import { appendMessage, compactConversation } from "./workflow/engine.ts";
import { Orchestrator } from "./engine/orchestrator.ts";
import { getResolvedShellEnv } from "./shell-env.ts";
import type { TaskRow, ConversationMessageRow } from "./db/row-types.ts";
import type { StreamEvent } from "../shared/rpc-types.ts";
import type { Task, ConversationMessage } from "../shared/rpc-types.ts";
// ─── Bootstrap ───────────────────────────────────────────────────────────────

// 0. Resolve shell environment at startup (captures user PATH from login shell)
//    This must happen before any module spawns processes, so all downstream
//    spawn/spawnSync calls inherit the full environment. Skipped on Windows and
//    if launched from terminal (RAILYN_CLI=1).
await getResolvedShellEnv();

// 1. Run DB migrations, sync config-backed rows, then seed any test-only defaults.
runMigrations();
seedDefaultWorkspace();

// 2. Load default workspace config (YAML files)
const { error: configError } = loadConfig();

// 3. Reset any tasks/executions that were still 'running' or 'waiting_user' when
//    the process last exited (crash, SIGKILL, etc.) so they don't appear stuck forever.
//    'waiting_user' is included because non-native engines (CopilotEngine, ClaudeEngine)
//    hold the resume promise in memory — after a restart that in-memory state is gone and
//    any future message would call engine.resume() on a dead execution.
{
  const db = getDb();
  const stuckCount = db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM tasks WHERE execution_state IN ('running', 'waiting_user')")
    .get()?.n ?? 0;
  if (stuckCount > 0) {
    console.warn(`[db] Resetting ${stuckCount} task(s) stuck in 'running'/'waiting_user' state from previous session`);
    db.run("UPDATE tasks SET execution_state = 'failed' WHERE execution_state IN ('running', 'waiting_user')");
    db.run(
      `UPDATE executions SET status = 'failed', finished_at = datetime('now'),
       details = 'Process restarted while execution was running'
       WHERE status IN ('running', 'waiting_user')`,
    );
  }
}

// ─── WebSocket push: connected browser clients ────────────────────────────────

const clients = new Set<ServerWebSocket<WsData>>();

function broadcast(msg: object): void {
  const text = JSON.stringify(msg);
  for (const ws of clients) {
    try { ws.send(text); } catch { /* client disconnected — will be removed on close */ }
  }
}

// ─── Push callbacks ───────────────────────────────────────────────────────────

function onToken(taskId: number, executionId: number, token: string, done: boolean, isReasoning?: boolean, isStatus?: boolean): void {
  broadcast({ type: "stream.token", payload: { taskId, executionId, token, done, isReasoning, isStatus } });
}

function onError(taskId: number, executionId: number, error: string): void {
  broadcast({ type: "stream.error", payload: { taskId, executionId, error } });
}

function notifyTaskUpdated(task: Task): void {
  broadcast({ type: "task.updated", payload: task });
}

function notifyNewMessage(message: ConversationMessage): void {
  broadcast({ type: "message.new", payload: message });
}

function notifyWorkflowReloaded(): void {
  broadcast({ type: "workflow.reloaded", payload: {} });
}

// ─── Per-execution stream batchers ───────────────────────────────────────────
const batchers = new Map<number, StreamBatcher>();

function getOrCreateBatcher(taskId: number, executionId: number): StreamBatcher {
  const existing = batchers.get(executionId);
  if (existing) return existing;
  const batcher = new StreamBatcher(taskId, executionId, (_events) => {
    // DB writes are handled by StreamBatcher.flush() internally.
    // IPC delivery happens immediately in onStreamEvent — nothing to do here.
  });
  batcher.start();
  batchers.set(executionId, batcher);
  return batcher;
}

function onStreamEvent(event: StreamEvent): void {
  const batcher = getOrCreateBatcher(event.taskId, event.executionId);
  // ── Diagnostic: verify events are sent incrementally ──
  if (event.type === "text_chunk" || event.type === "reasoning_chunk") {
    console.log(`[stream-diag-bun] ${event.type} len=${event.content.length} t=${performance.now().toFixed(1)}`);
  }
  // ALL events go to push immediately — no 500ms delay for any event type.
  broadcast({ type: "stream.event", payload: event });
  batcher.push(event);
  if (event.done) {
    batchers.delete(event.executionId);
  }
}

// ─── Wire up RPC handlers ─────────────────────────────────────────────────────

// Create orchestrator once all RPC callbacks are defined
const orchestrator: Orchestrator | null = !configError
  ? new Orchestrator(
    onToken,
    onError,
    notifyTaskUpdated,
    notifyNewMessage,
  )
  : null;

if (orchestrator) {
  orchestrator.setOnStreamEvent(onStreamEvent);
}

// ─── Bun HTTP + WebSocket server ──────────────────────────────────────────────

const DIST_DIR = path.join(import.meta.dir, "../../dist");

const portArg = process.argv.find(a => a.startsWith("--port="));
const serverPort = portArg ? Number(portArg.split("=")[1]) : 3000;

const allHandlers: Record<string, (params: unknown) => unknown> = {
  ...workspaceHandlers(),
  ...boardHandlers(),
  ...projectHandlers(),
  ...taskHandlers(orchestrator, notifyTaskUpdated, notifyNewMessage),
  ...conversationHandlers(),
  ...workflowHandlers(notifyWorkflowReloaded),
  ...launchHandlers(),
  ...lspHandlers(),
  ...codeServerHandlers(broadcast, serverPort),
  ...mcpHandlers(),
};

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: serverPort,
  idleTimeout: 30,

  async fetch(req, srv) {
    const url = new URL(req.url);

    // WebSocket upgrade for push channel
    if (url.pathname === "/ws") {
      const upgraded = srv.upgrade<WsData>(req, { data: { type: "push" } });
      if (!upgraded) return new Response("WS upgrade failed", { status: 500 });
      return undefined as unknown as Response; // upgraded — no response needed
    }

    // WebSocket upgrade for PTY terminal sessions
    if (url.pathname.startsWith("/ws/pty/")) {
      const sessionId = url.pathname.slice(8); // "/ws/pty/".length === 8
      const upgraded = srv.upgrade<WsData>(req, { data: { type: "pty", sessionId } });
      if (!upgraded) return new Response("WS upgrade failed", { status: 500 });
      return undefined as unknown as Response;
    }

    // API: POST /api/<method>
    if (req.method === "POST" && url.pathname.startsWith("/api/")) {
      const method = url.pathname.slice(5); // strip leading "/api/"
      const handler = allHandlers[method];
      if (!handler) {
        return new Response(JSON.stringify({ error: `Unknown method: ${method}` }), {
          status: 404,
          headers: { "content-type": "application/json" },
        });
      }
      try {
        const params = await req.json();
        const result = await handler(params);
        return new Response(JSON.stringify(result), {
          headers: { "content-type": "application/json" },
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[api] ${method} error:`, msg);
        return new Response(JSON.stringify({ error: msg }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    // Static file serving — serve from dist/, SPA fallback to index.html
    let filePath = path.join(DIST_DIR, url.pathname === "/" ? "index.html" : url.pathname);
    let file = Bun.file(filePath);
    if (!(await file.exists())) {
      // SPA fallback: unknown paths → index.html
      filePath = path.join(DIST_DIR, "index.html");
      file = Bun.file(filePath);
    }
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(file);
  },

  websocket: {
    open(ws: ServerWebSocket<WsData>) {
      const data = ws.data;
      if (data.type === "pty") {
        // Attach PTY output to this WebSocket
        const session = getPtySession(data.sessionId);
        if (!session) {
          ws.close(4404, "session-not-found");
          return;
        }
        // Replay buffered output so the terminal catches up on reconnect
        if (session.scrollback) {
          try { ws.send(session.scrollback); } catch { /* ignore */ }
        }
        if (session.exited) {
          // Process already exited — scrollback already contains the exit message.
          // Keep the WS open so PtyTerminal doesn't enter a reconnect loop.
          return;
        }
        const listener = (chunk: string) => {
          try { ws.send(chunk); } catch { /* ws closed */ }
        };
        const exitListener = (_code: number) => {
          try { ws.close(4000, "process-exited"); } catch { /* ignore */ }
        };
        session.dataListeners.add(listener);
        session.exitListeners.add(exitListener);
        ptyDataListeners.set(ws, listener);
        ptyExitListeners.set(ws, exitListener);
      } else {
        clients.add(ws);
      }
    },
    close(ws: ServerWebSocket<WsData>) {
      if (ws.data.type === "push") {
        clients.delete(ws);
      } else {
        // Remove the data and exit listeners so they don't fire against a closed socket
        const session = getPtySession((ws.data as { type: "pty"; sessionId: string }).sessionId);
        const listener = ptyDataListeners.get(ws);
        const exitListener = ptyExitListeners.get(ws);
        if (session && listener) session.dataListeners.delete(listener);
        if (session && exitListener) session.exitListeners.delete(exitListener);
        ptyDataListeners.delete(ws);
        ptyExitListeners.delete(ws);
      }
    },
    message(ws: ServerWebSocket<WsData>, msg: string | Buffer) {
      if (ws.data.type === "pty") {
        const session = getPtySession(ws.data.sessionId);
        if (session) {
          const text = typeof msg === "string" ? msg : msg.toString("utf8");
          // Intercept resize control messages; everything else is stdin
          try {
            const parsed = JSON.parse(text);
            if (parsed?.type === "resize" && typeof parsed.cols === "number" && typeof parsed.rows === "number") {
              session.terminal?.resize(parsed.cols, parsed.rows);
              return;
            }
          } catch { /* not JSON — treat as raw input */ }
          session.terminal?.write(text);
        }
      }
      // push channel: no client→server messages currently
    },
  },
});

// Write the actual port for external tooling and the frontend to discover
await Bun.write("/tmp/railyn.port", String(server.port)).catch(() => { });
console.log(`Railyn server listening on http://127.0.0.1:${server.port}`);

// ─── Graceful shutdown ────────────────────────────────────────────────────────

const SHUTDOWN_GRACE_MS = Number(process.env.RAILYN_SHUTDOWN_GRACE_MS ?? 3_000);
let _shutdownStarted = false;

async function shutdown(): Promise<void> {
  if (_shutdownStarted) return;
  _shutdownStarted = true;

  try {
    await orchestrator?.shutdownNonNativeEngines?.({ reason: "app-exit", deadlineMs: SHUTDOWN_GRACE_MS });
  } catch (err) {
    console.warn("[shutdown] Graceful non-native shutdown failed", err instanceof Error ? err.message : String(err));
  }
  killAllPtySessions();
  stopAllCodeServers();
  process.exit(0);
}

process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });

// ─── Debug / test server (only when RAILYN_DEBUG=1) ───────────────────────────
// Port 0 = OS-assigned. Port is written to /tmp/railyn-debug.port for bridge.ts.
// Endpoints here are test-only helpers that reach directly into the DB and orchestrator.
// WebView-specific endpoints (/inspect, /click, /screenshot) have been removed
// because there is no WebView in the web-app architecture.

// Module-level cache of the test worktree path so /reset-decisions can restore it.
let _testWorktreePath = "";

if (process.env.RAILYN_DEBUG) {
  const debugServer = Bun.serve({
    port: 0, // always OS-assigned for test parallelism
    idleTimeout: 30,
    async fetch(req: Request) {
      const url = new URL(req.url);

      // Test-only: delete all hunk decisions (and line comments) for a task so tests start from a clean state.
      // Also cancels any running execution and ensures the git context is intact.
      if (url.pathname === "/reset-decisions") {
        const taskId = url.searchParams.get("taskId");
        if (!taskId) return new Response(JSON.stringify({ __error: "taskId required" }), { status: 400, headers: { "content-type": "application/json" } });
        const tid = parseInt(taskId, 10);
        const db = getDb();

        // Cancel any running execution to prevent background interference
        const execRow = db.query<{ current_execution_id: number | null }, [number]>(
          "SELECT current_execution_id FROM tasks WHERE id = ?",
        ).get(tid);
        if (execRow?.current_execution_id != null) {
          orchestrator?.cancel(execRow.current_execution_id);
          // Give a moment for cancellation to settle
          await new Promise(r => setTimeout(r, 100));
        }
        // Reset execution state to idle
        db.run("UPDATE tasks SET execution_state = 'idle', current_execution_id = NULL WHERE id = ?", [tid]);
        // Mark any lingering running executions as cancelled
        db.run("UPDATE executions SET status = 'cancelled', finished_at = datetime('now') WHERE task_id = ? AND status = 'running'", [tid]);

        db.run("DELETE FROM task_hunk_decisions WHERE task_id = ?", [tid]);
        db.run("DELETE FROM task_line_comments WHERE task_id = ?", [tid]);

        // Ensure git context is intact — re-insert if the row was deleted by a background execution.
        const gitRow = db.query<{ worktree_path: string | null }, [number]>(
          "SELECT worktree_path FROM task_git_context WHERE task_id = ?",
        ).get(tid);
        if ((!gitRow || !gitRow.worktree_path) && _testWorktreePath) {
          if (!gitRow) {
            db.run(
              "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
              [tid, _testWorktreePath, _testWorktreePath],
            );
          } else {
            db.run(
              "UPDATE task_git_context SET worktree_path = ?, git_root_path = ?, worktree_status = 'ready' WHERE task_id = ?",
              [_testWorktreePath, _testWorktreePath, tid],
            );
          }
        }

        // Write debug info to a file for diagnostics
        const gitRowAfter = db.query<{ worktree_path: string | null }, [number]>(
          "SELECT worktree_path FROM task_git_context WHERE task_id = ?",
        ).get(tid);
        const debugLine = JSON.stringify({
          ts: new Date().toISOString(),
          tid,
          _testWorktreePath,
          gitRowBefore: gitRow ? { wp: gitRow.worktree_path } : null,
          gitRowAfter: gitRowAfter ? { wp: gitRowAfter.worktree_path } : null,
        });
        const fs = await import("fs");
        fs.appendFileSync("/tmp/railyn-reset-debug.log", debugLine + "\n");

        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      }

      // Test-only: query line comments from the DB for a task.
      if (url.pathname === "/query-line-comments") {
        const taskId = url.searchParams.get("taskId");
        if (!taskId) return new Response(JSON.stringify({ __error: "taskId required" }), { status: 400, headers: { "content-type": "application/json" } });
        const db = getDb();
        const rows = db.query<{ id: number; file_path: string; line_start: number; line_end: number; col_start: number; col_end: number; comment: string; sent: number }, [number]>(
          "SELECT id, file_path, line_start, line_end, col_start, col_end, comment, sent FROM task_line_comments WHERE task_id = ? ORDER BY id",
        ).all(parseInt(taskId, 10));
        return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } });
      }

      // Test-only: query hunk decisions from the DB for a task.
      if (url.pathname === "/query-hunk-decisions") {
        const taskId = url.searchParams.get("taskId");
        if (!taskId) return new Response(JSON.stringify({ __error: "taskId required" }), { status: 400, headers: { "content-type": "application/json" } });
        const db = getDb();
        const rows = db.query<{ id: number; file_path: string; hash: string; decision: string; sent: number }, [number]>(
          "SELECT rowid as id, file_path, hunk_hash as hash, decision, sent FROM task_hunk_decisions WHERE task_id = ? AND reviewer_id = 'user' ORDER BY rowid",
        ).all(parseInt(taskId, 10));
        return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } });
      }

      // Test-only: query conversation messages for a task.
      if (url.pathname === "/query-messages") {
        const taskId = url.searchParams.get("taskId");
        if (!taskId) return new Response(JSON.stringify({ __error: "taskId required" }), { status: 400, headers: { "content-type": "application/json" } });
        const db = getDb();
        const rows = db.query<{ id: number; role: string; type: string; content: string; created_at: string }, [number]>(
          "SELECT id, role, type, content, created_at FROM conversation_messages WHERE task_id = ? ORDER BY id ASC",
        ).all(parseInt(taskId, 10));
        return new Response(JSON.stringify(rows), { headers: { "content-type": "application/json" } });
      }

      // Test-only: diagnostic for reject-hunk test path.
      if (url.pathname === "/test-reject-hunk") {
        const taskId = url.searchParams.get("taskId");
        const filePath = url.searchParams.get("filePath");
        if (!taskId || !filePath) return new Response(JSON.stringify({ __error: "taskId and filePath required" }), { status: 400, headers: { "content-type": "application/json" } });
        try {
          const db = getDb();
          const gitRow = db.query<{ worktree_path: string | null; base_sha: string | null }, [number]>(
            "SELECT worktree_path, base_sha FROM task_git_context WHERE task_id = ?",
          ).get(parseInt(taskId, 10));
          const worktreePath = gitRow?.worktree_path ?? "";
          const baseSha = gitRow?.base_sha ?? null;
          const fileExists = worktreePath ? await Bun.file(`${worktreePath}/${filePath}`).exists() : false;
          const fileSize = fileExists ? (await Bun.file(`${worktreePath}/${filePath}`).text()).length : 0;

          let gitStatus = "";
          let gitDiff = "";
          let gitShowExitCode = -1;
          if (worktreePath) {
            const statusProc = Bun.spawn(["git", "status", "--porcelain", "--", filePath], { cwd: worktreePath, stdout: "pipe", stderr: "pipe" });
            await statusProc.exited;
            gitStatus = await new Response(statusProc.stdout).text();

            const baseRef = baseSha ?? "HEAD";
            const diffArgs = baseRef !== "HEAD"
              ? ["git", "diff", baseRef, "HEAD", "--", filePath]
              : ["git", "diff", "HEAD", "--", filePath];
            const diffProc = Bun.spawn(diffArgs, { cwd: worktreePath, stdout: "pipe", stderr: "pipe" });
            await diffProc.exited;
            gitDiff = (await new Response(diffProc.stdout).text()).slice(0, 500);

            const showProc = Bun.spawn(["git", "show", `${baseRef}:${filePath}`], { cwd: worktreePath, stdout: "pipe", stderr: "pipe" });
            await showProc.exited;
            gitShowExitCode = showProc.exitCode ?? -1;
          }

          return new Response(JSON.stringify({
            worktreePath, baseSha, fileExists, fileSize,
            gitStatus: gitStatus.trim(),
            gitDiffLen: gitDiff.length,
            gitDiffPreview: gitDiff.slice(0, 200),
            gitShowExitCode,
          }), { headers: { "content-type": "application/json" } });
        } catch (e) {
          return new Response(JSON.stringify({ __error: String(e) }), { status: 500, headers: { "content-type": "application/json" } });
        }
      }

      // Test-only: create a self-contained test task in a temp git worktree with
      // known files. Returns { taskId, files, worktreePath }.
      if (url.pathname === "/setup-test-env") {
        try {
          const db = getDb();

          // Clean up any previous test task so we don't accumulate stale rows.
          const prev = db.query<{ id: number; conversation_id: number | null }, []>("SELECT id, conversation_id FROM tasks WHERE title = 'UI Test Task' LIMIT 1").get();
          if (prev) {
            db.transaction(() => {
              db.run(
                "DELETE FROM task_execution_checkpoints WHERE execution_id IN (SELECT id FROM executions WHERE task_id = ?)",
                [prev.id],
              );
              db.run("DELETE FROM task_hunk_decisions WHERE task_id = ?", [prev.id]);
              db.run("DELETE FROM task_line_comments WHERE task_id = ?", [prev.id]);
              db.run("DELETE FROM task_todos WHERE task_id = ?", [prev.id]);
              db.run("DELETE FROM pending_messages WHERE task_id = ?", [prev.id]);
              db.run("DELETE FROM task_git_context WHERE task_id = ?", [prev.id]);
              db.run("DELETE FROM executions WHERE task_id = ?", [prev.id]);
              db.run("DELETE FROM conversation_messages WHERE task_id = ?", [prev.id]);
              db.run("DELETE FROM tasks WHERE id = ?", [prev.id]);
              if (prev.conversation_id) {
                db.run("DELETE FROM conversations WHERE id = ?", [prev.conversation_id]);
              }
            })();
          }

          // Resolve board + project keys
          let boardId: number;
          let projectKey: string;
          const existingTask = db.query<{ board_id: number; project_key: string }, []
          >("SELECT board_id, project_key FROM tasks WHERE title != 'UI Test Task' LIMIT 1").get();
          if (existingTask) {
            boardId = existingTask.board_id;
            projectKey = existingTask.project_key;
          } else {
            const workspaceRegistry = getWorkspaceRegistry();
            const defaultWorkspace = workspaceRegistry[0];
            const workspaceKey = defaultWorkspace?.key ?? "default";

            const boardRow = db
              .query<{ id: number }, [string]>(
                "SELECT id FROM boards WHERE workspace_key = ? ORDER BY id LIMIT 1",
              )
              .get(workspaceKey);
            if (boardRow) {
              boardId = boardRow.id;
            } else {
              db.run(
                "INSERT INTO boards (workspace_key, name, workflow_template_id, project_keys) VALUES (?, 'Test Board', 'delivery', '[]')",
                [workspaceKey],
              );
              boardId = db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!.id;
            }

            const projects = listProjects();
            projectKey = projects[0]?.key ?? "default";
          }

          // Create a temp git repo with known test files.
          const worktreePath = `/tmp/railyn-test-worktree-${Date.now()}`;
          _testWorktreePath = worktreePath;
          const run = (cmd: string[], cwd?: string) => {
            const p = Bun.spawnSync(cmd, { cwd: cwd ?? worktreePath, stdout: "pipe", stderr: "pipe" });
            if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed: ${p.stderr.toString().trim()}`);
          };

          Bun.spawnSync(["mkdir", "-p", worktreePath]);
          run(["git", "init"], worktreePath);
          run(["git", "config", "user.email", "test@railyn.internal"]);
          run(["git", "config", "user.name", "Railyn Test"]);

          const partialXBase = [
            "// partial-x.ts: committed base",
            "export function alpha() { return 1; }",
            "export function beta()  { return 2; }",
            "export function gamma() { return 3; }",
            "",
            "// middle section — unchanged (must be ≥7 lines so git produces two separate hunks)",
            "export const VERSION = '1.0.0';",
            "export const NAME    = 'partial-x';",
            "export const AUTHOR  = 'test';",
            "export const LICENSE = 'MIT';",
            "export const STABLE1 = true;",
            "export const STABLE2 = true;",
            "export const STABLE3 = true;",
            "",
            "export function delta()   { return 4; }",
            "export function epsilon() { return 5; }",
            "export function zeta()    { return 6; }",
          ].join("\n");

          const partialYBase = [
            "// partial-y.ts: committed base",
            "export class ServiceA {",
            "  greet() { return 'hello'; }",
            "  run()   { return 'running'; }",
            "}",
            "",
            "// stable section — unchanged (must be ≥7 lines so git produces two separate hunks)",
            "export const MAX_RETRIES = 3;",
            "export const TIMEOUT_MS  = 5000;",
            "export const BACKOFF_MS  = 200;",
            "export const MAX_QUEUE   = 100;",
            "export const LOG_LEVEL   = 'info';",
            "export const DRY_RUN     = false;",
            "export const STABLE_Y    = true;",
            "",
            "export class ServiceB {",
            "  stop()  { return 'stopped'; }",
            "  reset() { return 'reset'; }",
            "}",
          ].join("\n");

          await Bun.write(`${worktreePath}/partial-x.ts`, partialXBase);
          await Bun.write(`${worktreePath}/partial-y.ts`, partialYBase);
          run(["git", "add", "partial-x.ts", "partial-y.ts"]);
          run(["git", "commit", "-m", "add partial base files"]);

          const partialXModified = [
            "// partial-x.ts: worktree modifications",
            "export function alpha() { return 'alpha'; }",
            "export function beta()  { return 'beta'; }",
            "export function gamma() { return 'gamma'; }",
            "",
            "// middle section — unchanged (must be ≥7 lines so git produces two separate hunks)",
            "export const VERSION = '1.0.0';",
            "export const NAME    = 'partial-x';",
            "export const AUTHOR  = 'test';",
            "export const LICENSE = 'MIT';",
            "export const STABLE1 = true;",
            "export const STABLE2 = true;",
            "export const STABLE3 = true;",
            "",
            "export function delta()   { return 'delta'; }",
            "export function epsilon() { return 'epsilon'; }",
            "export function zeta()    { return 'zeta'; }",
          ].join("\n");

          const partialYModified = [
            "// partial-y.ts: worktree modifications",
            "export class ServiceA {",
            "  greet() { return 'hi there'; }",
            "  run()   { return 'active'; }",
            "}",
            "",
            "// stable section — unchanged (must be ≥7 lines so git produces two separate hunks)",
            "export const MAX_RETRIES = 3;",
            "export const TIMEOUT_MS  = 5000;",
            "export const BACKOFF_MS  = 200;",
            "export const MAX_QUEUE   = 100;",
            "export const LOG_LEVEL   = 'info';",
            "export const DRY_RUN     = false;",
            "export const STABLE_Y    = true;",
            "",
            "export class ServiceB {",
            "  stop()  { return 'halted'; }",
            "  reset() { return 'cleared'; }",
            "}",
          ].join("\n");

          await Bun.write(`${worktreePath}/partial-x.ts`, partialXModified);
          await Bun.write(`${worktreePath}/partial-y.ts`, partialYModified);

          const newFiles: [string, string][] = [
            ["feature-a.ts", Array.from({ length: 20 }, (_, i) => `export const lineA${i + 1} = ${i + 1};`).join("\n")],
            ["feature-b.vue", ["<template>", "  <div class=\"feature-b\">", "    <h1>Feature B</h1>", "    <p>Test component</p>", "  </div>", "</template>", "", "<script setup lang=\"ts\">", "const msg = 'hello from B';", "</script>"].join("\n")],
            ["feature-c.md", ["# Feature C", "", "This is a test markdown file.", "", "## Details", "", "- Point one", "- Point two", "- Point three"].join("\n")],
          ];
          for (const [name, content] of newFiles) {
            await Bun.write(`${worktreePath}/${name}`, content);
          }

          const convResult = db.run("INSERT INTO conversations (task_id) VALUES (0)");
          const conversationId = convResult.lastInsertRowid as number;

          db.run(
            "INSERT INTO tasks (board_id, project_key, title, description, workflow_state, execution_state, model, conversation_id) VALUES (?, ?, 'UI Test Task', 'Auto-created by test suite', 'backlog', 'idle', 'fake/test', ?)",
            [boardId, projectKey, conversationId],
          );
          const taskRow = db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!;
          const taskId = taskRow.id;
          const boardWorkspace = db
            .query<{ workspace_key: string }, [number]>("SELECT workspace_key FROM boards WHERE id = ?")
            .get(boardId);
          const workspaceKey = boardWorkspace?.workspace_key ?? "default";

          db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [taskId, conversationId]);

          db.run(
            "INSERT OR IGNORE INTO enabled_models (workspace_key, qualified_model_id) VALUES (?, 'fake/test')",
            [workspaceKey],
          );
          db.run(
            "INSERT OR IGNORE INTO enabled_models (workspace_key, qualified_model_id) VALUES (?, 'fake/v2')",
            [workspaceKey],
          );

          db.run(
            "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
            [taskId, worktreePath, worktreePath],
          );

          const files = ["partial-x.ts", "partial-y.ts", ...newFiles.map(([name]) => name)];
          return new Response(JSON.stringify({ taskId, files, worktreePath }), { headers: { "content-type": "application/json" } });
        } catch (e) {
          return new Response(JSON.stringify({ __error: String(e) }), { status: 500, headers: { "content-type": "application/json" } });
        }
      }

      // Test-only: seed synthetic tool-call conversations for drawer rendering tests.
      if (url.pathname === "/seed-tool-messages") {
        const taskId = Number(url.searchParams.get("taskId"));
        const scenario = url.searchParams.get("scenario") ?? "";
        if (!taskId || !scenario) {
          return new Response(JSON.stringify({ __error: "taskId and scenario required" }), {
            status: 400,
            headers: { "content-type": "application/json" },
          });
        }

        try {
          const db = getDb();
          const task = db.query<{ conversation_id: number | null }, [number]>(
            "SELECT conversation_id FROM tasks WHERE id = ?",
          ).get(taskId);
          const conversationId = task?.conversation_id ?? 0;
          if (!conversationId) throw new Error(`Task ${taskId} has no conversation`);

          db.run("DELETE FROM conversation_messages WHERE task_id = ?", [taskId]);
          db.run("UPDATE tasks SET execution_state = 'idle', current_execution_id = NULL WHERE id = ?", [taskId]);

          const makeCall = (
            callId: string,
            name: string,
            args: Record<string, unknown>,
            metadata?: Record<string, unknown>,
          ) => {
            appendMessage(
              taskId,
              conversationId,
              "tool_call",
              null,
              JSON.stringify({
                type: "function",
                function: { name, arguments: JSON.stringify(args) },
                id: callId,
              }),
              metadata,
            );
          };

          const makeResult = (
            callId: string,
            content: string,
            extra: Record<string, unknown> = {},
            metadata?: Record<string, unknown>,
          ) => {
            appendMessage(
              taskId,
              conversationId,
              "tool_result",
              null,
              JSON.stringify({
                type: "tool_result",
                tool_use_id: callId,
                content,
                detailedContent: content,
                is_error: false,
                ...extra,
              }),
              { tool_call_id: callId, ...(metadata ?? {}) },
            );
          };

          switch (scenario) {
            case "batched": {
              const paths = ["alpha.ts", "beta.ts", "gamma.ts", "delta.ts"];
              for (const path of paths) makeCall(`call_${path}`, "read_file", { path });
              for (const path of paths) makeResult(`call_${path}`, `RESULT:${path}`);
              break;
            }

            case "copilot-diff": {
              makeCall("call_edit", "edit_file", { path: "partial-x.ts" });
              makeResult(
                "call_edit",
                "Updated partial-x.ts",
                {
                  writtenFiles: [
                    {
                      operation: "edit_file",
                      path: "partial-x.ts",
                      rawDiff: [
                        "--- a/partial-x.ts",
                        "+++ b/partial-x.ts",
                        "@@ -1,2 +1,2 @@",
                        "-export function alpha() { return 1; }",
                        "+export function alpha() { return 'alpha'; }",
                      ].join("\n"),
                    },
                  ],
                },
              );
              break;
            }

            case "subagent": {
              makeCall("call_spawn", "spawn_agent", { prompt: "Inspect files" });
              makeCall("call_child_1", "read_file", { path: "alpha.ts" }, { parent_tool_call_id: "call_spawn" });
              makeCall("call_child_2", "list_dir", { path: "src" }, { parent_tool_call_id: "call_spawn" });
              makeCall("call_child_3", "edit_file", { path: "beta.ts" }, { parent_tool_call_id: "call_spawn" });

              makeResult("call_spawn", "Subagent completed");
              makeResult("call_child_1", "alpha contents", { parent_tool_call_id: "call_spawn" });
              makeResult("call_child_2", "src\nsrc/main.ts", { parent_tool_call_id: "call_spawn" });
              makeResult("call_child_3", "beta updated", { parent_tool_call_id: "call_spawn" });
              break;
            }

            case "timeout": {
              const msgId = appendMessage(
                taskId,
                conversationId,
                "tool_call",
                null,
                JSON.stringify({
                  type: "function",
                  function: { name: "run_command", arguments: JSON.stringify({ command: "sleep 999" }) },
                  id: "call_timeout",
                }),
              );
              db.run(
                "UPDATE conversation_messages SET created_at = datetime('now', '-40 seconds') WHERE id = ?",
                [msgId],
              );
              break;
            }

            default:
              return new Response(JSON.stringify({ __error: `Unknown scenario: ${scenario}` }), {
                status: 400,
                headers: { "content-type": "application/json" },
              });
          }

          return new Response(JSON.stringify({ ok: true, scenario }), {
            headers: { "content-type": "application/json" },
          });
        } catch (e) {
          return new Response(JSON.stringify({ __error: String(e) }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      }

      // Test-only: send a chat message directly via handleHumanTurn, bypassing the
      // RPC/IPC path that would deadlock when called from inside webEval.
      // Returns { messageId, executionId } immediately; streaming arrives via normal IPC.
      if (url.pathname === "/test-send-message") {
        const taskId = Number(url.searchParams.get("taskId"));
        const text = url.searchParams.get("text") ?? "";
        if (!taskId || !text) {
          return new Response(JSON.stringify({ __error: "taskId and text required" }), { status: 400, headers: { "content-type": "application/json" } });
        }
        try {
          if (!orchestrator) throw new Error("Engine not initialized");
          const { message, executionId } = await orchestrator.executeHumanTurn(
            taskId,
            text,
          );
          // Push the user message to the Vue store via IPC — in the normal RPC
          // path, sendMessage() does messages.value.push(message) from the RPC
          // response.  The HTTP endpoint bypasses that, so we push it here.
          // onNewMessage in the store deduplicates by id, so it's safe to call.
          notifyNewMessage(message);
          return new Response(JSON.stringify({ messageId: message.id, executionId }), { headers: { "content-type": "application/json" } });
        } catch (e) {
          return new Response(JSON.stringify({ __error: String(e) }), { status: 500, headers: { "content-type": "application/json" } });
        }
      }

      // Test-only: cancel the running execution for a task.
      // Returns { ok, executionState } once the AbortController is signalled.
      // The actual DB state update happens async in runExecution; tests must
      // poll getActiveTaskExecutionState() for 'waiting_user'.
      if (url.pathname === "/test-cancel") {
        const taskId = Number(url.searchParams.get("taskId"));
        if (!taskId) return new Response(JSON.stringify({ __error: "taskId required" }), { status: 400, headers: { "content-type": "application/json" } });
        const db = getDb();
        const row = db.query<{ current_execution_id: number | null }, [number]>(
          "SELECT current_execution_id FROM tasks WHERE id = ?",
        ).get(taskId);
        if (row?.current_execution_id != null) {
          orchestrator?.cancel(row.current_execution_id);
        }
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      }

      // Test-only: change the model for a task and push updated task via IPC.
      // Returns { taskId, model } on success.
      if (url.pathname === "/test-set-model") {
        const taskId = Number(url.searchParams.get("taskId"));
        const model = url.searchParams.get("model") ?? "";
        if (!taskId || !model) return new Response(JSON.stringify({ __error: "taskId and model required" }), { status: 400, headers: { "content-type": "application/json" } });
        const db = getDb();
        db.run("UPDATE tasks SET model = ? WHERE id = ?", [model, taskId]);
        const taskRow = db.query<TaskRow, [number]>("SELECT * FROM tasks WHERE id = ?").get(taskId);
        if (taskRow) notifyTaskUpdated(mapTask(taskRow));
        return new Response(JSON.stringify({ taskId, model }), { headers: { "content-type": "application/json" } });
      }

      // Test-only: trigger compaction for a task and push the resulting
      // compaction_summary message via IPC so the Vue store receives it.
      // Returns { ok, messageId } on success, or { __error } on failure.
      if (url.pathname === "/test-compact") {
        const taskId = Number(url.searchParams.get("taskId"));
        if (!taskId) return new Response(JSON.stringify({ __error: "taskId required" }), { status: 400, headers: { "content-type": "application/json" } });
        try {
          const summary = await compactConversation(taskId);
          // Push the new compaction_summary message to Vue so the test can detect it
          // without having to fire-and-forget a loadMessages call from webEval.
          notifyNewMessage(summary);
          return new Response(JSON.stringify({ ok: true, messageId: summary.id }), { headers: { "content-type": "application/json" } });
        } catch (e) {
          return new Response(JSON.stringify({ __error: String(e) }), { status: 500, headers: { "content-type": "application/json" } });
        }
      }

      // Test-only: transition a task to a new workflow state, running any on_enter_prompt.
      // Returns { task, executionId } immediately; execution runs asynchronously via IPC.
      if (url.pathname === "/test-transition") {
        const taskId = Number(url.searchParams.get("taskId"));
        const toState = url.searchParams.get("toState") ?? "";
        if (!taskId || !toState) {
          return new Response(JSON.stringify({ __error: "taskId and toState required" }), { status: 400, headers: { "content-type": "application/json" } });
        }
        try {
          if (!orchestrator) throw new Error("Engine not initialized");
          const result = await orchestrator.executeTransition(taskId, toState);
          // Push the updated task to the Vue store so the board re-renders the card
          // in the new column (analogous to how the RPC tasks.transition response
          // triggers store.onTaskUpdated in the Vue transitionTask() method).
          notifyTaskUpdated(result.task);
          return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
        } catch (e) {
          return new Response(JSON.stringify({ __error: String(e) }), { status: 500, headers: { "content-type": "application/json" } });
        }
      }

      // Test-only: push synthetic stream events directly to connected browser clients via WS.
      // Accepts a JSON body: { events: StreamEvent[] }
      if (url.pathname === "/queue-stream-events") {
        try {
          const body = await req.json() as { events?: unknown[] };
          if (!Array.isArray(body.events)) {
            return new Response(JSON.stringify({ __error: "events array required" }), {
              status: 400,
              headers: { "content-type": "application/json" },
            });
          }
          for (const event of body.events) {
            broadcast({ type: "stream.event", payload: event });
          }
          return new Response(JSON.stringify({ ok: true, count: body.events.length }), {
            headers: { "content-type": "application/json" },
          });
        } catch (e) {
          return new Response(JSON.stringify({ __error: String(e) }), {
            status: 500,
            headers: { "content-type": "application/json" },
          });
        }
      }

      if (url.pathname === "/shutdown") {
        setTimeout(() => process.exit(0), 50);
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      }

      return new Response("paths: /reset-decisions?taskId=, /query-line-comments?taskId=, /query-hunk-decisions?taskId=, /query-messages?taskId=, /test-reject-hunk?taskId=&filePath=, /setup-test-env, /seed-tool-messages?taskId=&scenario=, /test-send-message?taskId=&text=, /test-cancel?taskId=, /test-set-model?taskId=&model=, /test-compact?taskId=, /test-transition?taskId=&toState=, /queue-stream-events, /shutdown", { status: 200 });
    },
  });
  // Announce the actual port. bridge.ts and run-ui-tests.sh read /tmp/railyn-debug.port for discovery.
  Bun.write("/tmp/railyn-debug.port", String(debugServer.port)).catch(() => { });
  console.log(`DEBUG_PORT=${debugServer.port}`);
}

// ─── Config error: push to connected clients ──────────────────────────────────

if (configError) {
  // Delay to give the browser time to connect before receiving the error push
  setTimeout(() => {
    broadcast({
      type: "stream.error",
      payload: {
        taskId: -1,
        executionId: -1,
        error: `Config error: ${configError}`,
      },
    });
  }, 2000);
}
