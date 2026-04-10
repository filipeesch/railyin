import Electrobun, { BrowserWindow, BrowserView } from "electrobun/bun";
import { runMigrations, seedDefaultWorkspace } from "./db/migrations.ts";
import { getDb } from "./db/index.ts";
import { loadConfig } from "./config/index.ts";

// ─── Global error handlers ────────────────────────────────────────────────────
// These must be registered before any async work so unhandled rejections from
// SDK events, network I/O, or other background tasks are captured and logged
// rather than crashing the process silently.
process.on("unhandledRejection", (reason) => {
  console.error("[railyin] Unhandled rejection:", reason);
});
process.on("uncaughtException", (err) => {
  console.error("[railyin] Uncaught exception:", err);
});

// ─── CLI flags (must run before any module reads process.env) ─────────────────
// --debug      → enables the debug HTTP server on :9229 (same as RAILYN_DEBUG=1)
// --memory-db  → uses an in-memory SQLite database (same as RAILYN_DB=:memory:)
const argv = process.argv.slice(2);
if (argv.includes("--debug")) process.env.RAILYN_DEBUG = "1";
if (argv.includes("--memory-db")) process.env.RAILYN_DB = ":memory:";
import { workspaceHandlers } from "./handlers/workspace.ts";
import { boardHandlers } from "./handlers/boards.ts";
import { projectHandlers } from "./handlers/projects.ts";
import { taskHandlers } from "./handlers/tasks.ts";
import { conversationHandlers } from "./handlers/conversations.ts";
import { workflowHandlers } from "./handlers/workflow.ts";
import { launchHandlers } from "./handlers/launch.ts";
import { lspHandlers } from "./handlers/lsp.ts";
import { mapTask } from "./db/mappers.ts";
import { compactConversation } from "./workflow/engine.ts";
import { resolveEngine } from "./engine/resolver.ts";
import { Orchestrator } from "./engine/orchestrator.ts";
import type { TaskRow, ConversationMessageRow } from "./db/row-types.ts";
import type { RailynRPCType } from "../shared/rpc-types.ts";
import type { Task, ConversationMessage } from "../shared/rpc-types.ts";
// ─── Bootstrap ───────────────────────────────────────────────────────────────

// 1. Load config (YAML files)
const { config, error: configError } = loadConfig();

// 2. Run DB migrations + seed default workspace
runMigrations();
seedDefaultWorkspace();

// 3. Reset any tasks/executions that were still 'running' when the process
//    last exited (crash, SIGKILL, etc.) so they don't appear stuck forever.
{
  const db = getDb();
  const stuckCount = db
    .query<{ n: number }, []>("SELECT COUNT(*) AS n FROM tasks WHERE execution_state = 'running'")
    .get()?.n ?? 0;
  if (stuckCount > 0) {
    console.warn(`[db] Resetting ${stuckCount} task(s) stuck in 'running' state from previous session`);
    db.run("UPDATE tasks SET execution_state = 'failed' WHERE execution_state = 'running'");
    db.run(
      `UPDATE executions SET status = 'failed', finished_at = datetime('now'),
       details = 'Process restarted while execution was running'
       WHERE status = 'running'`,
    );
  }
}

// ─── IPC streaming callbacks (capture win lazily — only called after win is created) ──

let win!: BrowserWindow;

function onToken(taskId: number, executionId: number, token: string, done: boolean, isReasoning?: boolean, isStatus?: boolean): void {
  win.webview.rpc.send["stream.token"]({ taskId, executionId, token, done, isReasoning, isStatus });
}

function onError(taskId: number, executionId: number, error: string): void {
  win.webview.rpc.send["stream.error"]({ taskId, executionId, error });
}

function notifyTaskUpdated(task: Task): void {
  win.webview.rpc.send["task.updated"](task);
}

function notifyNewMessage(message: ConversationMessage): void {
  win.webview.rpc.send["message.new"](message);
}

function notifyWorkflowReloaded(): void {
  win.webview.rpc.send["workflow.reloaded"]({});
}

// ─── Wire up RPC handlers ─────────────────────────────────────────────────────

// Create engine + orchestrator once all RPC callbacks are defined
const orchestrator: Orchestrator | null = config
  ? new Orchestrator(
      resolveEngine(config, notifyTaskUpdated, notifyNewMessage),
      onToken,
      onError,
      notifyTaskUpdated,
      notifyNewMessage,
    )
  : null;

const mainWebviewRPC = BrowserView.defineRPC<RailynRPCType>({
  handlers: {
    requests: {
      ...workspaceHandlers(),
      ...boardHandlers(),
      ...projectHandlers(),
      ...taskHandlers(orchestrator, notifyTaskUpdated, notifyNewMessage),
      ...conversationHandlers(),
      ...workflowHandlers(notifyWorkflowReloaded),
      ...launchHandlers(),
      ...lspHandlers(),
    },
    messages: {
      "debug.log": ({ level, args }) => {
        const prefix = level === "error" ? "[WebView ERROR]" : level === "warn" ? "[WebView WARN]" : "[WebView LOG]";
        console.log(prefix, args);
      },
    },
  },
});

// ─── App window ──────────────────────────────────────────────────────────────

win = new BrowserWindow({
  url: "views://mainview/index.html",
  title: "Railyn",
  frame: { width: 1400, height: 900 },
  rpc: mainWebviewRPC,
});

// When the window is closed, kill the entire process group so the
// 'electrobun dev --watch' node watcher also terminates.
// forceExit() only kills this bun subprocess; the watcher parent stays
// alive (and would restart the app) otherwise.
Electrobun.events.on("before-quit", () => {
  try {
    const result = Bun.spawnSync(["bash", "-c", `ps -o pgid= -p ${process.pid}`]);
    const pgid = parseInt(result.stdout.toString().trim(), 10);
    if (pgid > 1) {
      process.kill(-pgid, "SIGTERM");
    }
  } catch {
    try { process.kill(process.ppid, "SIGTERM"); } catch { /* ignore */ }
  }
});

// ─── Debug HTTP server (dev only, --debug flag) ──────────────────────────────
// Enable with: bun run dev:debug
// curl "http://localhost:9229/inspect?script=return+JSON.stringify(document.querySelector('.hunk-btn--accept')?.getBoundingClientRect())"
// curl "http://localhost:9229/click?selector=.hunk-btn--accept"

if (process.env.RAILYN_DEBUG) Bun.serve({
  port: 9229,
  async fetch(req: Request) {
    const url = new URL(req.url);

    if (url.pathname === "/inspect") {
      // Accept script from POST body (for long scripts) or query param
      let script = url.searchParams.get("script");
      if (!script && req.method === "POST") {
        script = await req.text();
      }
      script ??= "return document.title";
      // Wrap in try/catch so JS errors are returned as {"__error":"..."} instead of silently failing
      const safe = `try { ${script} } catch (__err) { return JSON.stringify({__error: String(__err)}); }`;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (win.webview as any).rpc.request["evaluateJavascriptWithResponse"]({ script: safe });
        return new Response(JSON.stringify(result, null, 2), {
          headers: { "content-type": "application/json" },
        });
      } catch (e) {
        return new Response(JSON.stringify({ __error: String(e) }), {
          status: 500,
          headers: { "content-type": "application/json" },
        });
      }
    }

    if (url.pathname === "/click") {
      const selector = url.searchParams.get("selector") ?? "";
      const script = `
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return 'NOT FOUND';
        el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('mouseup',   { bubbles: true, cancelable: true }));
        el.dispatchEvent(new MouseEvent('click',     { bubbles: true, cancelable: true }));
        return 'clicked: ' + el.outerHTML.slice(0, 200);
      `;
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (win.webview as any).rpc.request["evaluateJavascriptWithResponse"]({ script });
        return new Response(JSON.stringify(result), { headers: { "content-type": "application/json" } });
      } catch (e) {
        return new Response(String(e), { status: 500 });
      }
    }

    if (url.pathname === "/screenshot") {
      const dest = url.searchParams.get("path") ?? `/tmp/railyn-debug-${Date.now()}.png`;
      const proc = Bun.spawnSync(["screencapture", "-T", "0", "-a", dest]);
      if (proc.exitCode !== 0) {
        return new Response(JSON.stringify({ __error: proc.stderr.toString() }), { status: 500, headers: { "content-type": "application/json" } });
      }
      return new Response(JSON.stringify({ path: dest }), { headers: { "content-type": "application/json" } });
    }

    // Test-only: delete all hunk decisions (and line comments) for a task so tests start from a clean state.
    if (url.pathname === "/reset-decisions") {
      const taskId = url.searchParams.get("taskId");
      if (!taskId) return new Response(JSON.stringify({ __error: "taskId required" }), { status: 400, headers: { "content-type": "application/json" } });
      const db = getDb();
      db.run("DELETE FROM task_hunk_decisions WHERE task_id = ?", [parseInt(taskId, 10)]);
      db.run("DELETE FROM task_line_comments WHERE task_id = ?", [parseInt(taskId, 10)]);
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
    }

    // Test-only: query line comments from the DB for a task.
    // Returns all rows from task_line_comments for the given taskId.
    if (url.pathname === "/query-line-comments") {
      const taskId = url.searchParams.get("taskId");
      if (!taskId) return new Response(JSON.stringify({ __error: "taskId required" }), { status: 400, headers: { "content-type": "application/json" } });
      const db = getDb();
      const rows = db.query<{ id: number; file_path: string; line_start: number; line_end: number; comment: string; sent: number }, [number]>(
        "SELECT id, file_path, line_start, line_end, comment, sent FROM task_line_comments WHERE task_id = ? ORDER BY id",
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

    // Test-only: create a self-contained test task in a temp git worktree with
    // known files. Returns { taskId, files, worktreePath } so tests are not
    // coupled to any pre-existing app data.
    //
    // The worktree is a fresh git repo where 3 files are created as new untracked
    // additions, matching the simplest test scenario (each file = 1 hunk = 1 bar).
    if (url.pathname === "/setup-test-env") {
      try {
        const db = getDb();

        // Clean up any previous test task so we don't accumulate stale rows.
        const prev = db.query<{ id: number; conversation_id: number | null }, []>("SELECT id, conversation_id FROM tasks WHERE title = 'UI Test Task' LIMIT 1").get();
        if (prev) {
          db.run("DELETE FROM task_hunk_decisions WHERE task_id = ?", [prev.id]);
          db.run("DELETE FROM task_git_context WHERE task_id = ?", [prev.id]);
          db.run("DELETE FROM executions WHERE task_id = ?", [prev.id]);
          db.run("DELETE FROM conversation_messages WHERE task_id = ?", [prev.id]);
          db.run("DELETE FROM tasks WHERE id = ?", [prev.id]);
          if (prev.conversation_id) {
            db.run("DELETE FROM conversations WHERE id = ?", [prev.conversation_id]);
          }
        }

        // Resolve board + project IDs — either from an existing task (real DB mode)
        // or by seeding minimum rows (in-memory / clean test DB, i.e. RAILYN_DB=:memory:).
        let boardId: number;
        let projectId: number;
        const existingTask = db.query<{ board_id: number; project_id: number }, []
        >("SELECT board_id, project_id FROM tasks WHERE title != 'UI Test Task' LIMIT 1").get();
        if (existingTask) {
          boardId = existingTask.board_id;
          projectId = existingTask.project_id;
        } else {
          // In-memory test mode — seedDefaultWorkspace() has already created a
          // workspace, project and board. Just look them up.
          const boardRow = db.query<{ id: number }, []>("SELECT id FROM boards LIMIT 1").get();
          const projectRow = db.query<{ id: number }, []>("SELECT id FROM projects LIMIT 1").get();
          if (!boardRow || !projectRow) {
            return new Response(
              JSON.stringify({ __error: "No board or project found — make sure the app was started with bun run test:ui:run (which seeds them automatically)." }),
              { status: 500, headers: { "content-type": "application/json" } },
            );
          }
          boardId = boardRow.id;
          projectId = projectRow.id;
        }

        // Create a temp git repo with known test files.
        const worktreePath = `/tmp/railyn-test-worktree-${Date.now()}`;
        const run = (cmd: string[], cwd?: string) => {
          const p = Bun.spawnSync(cmd, { cwd: cwd ?? worktreePath, stdout: "pipe", stderr: "pipe" });
          if (p.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed: ${p.stderr.toString().trim()}`);
        };

        Bun.spawnSync(["mkdir", "-p", worktreePath]);
        run(["git", "init"], worktreePath);
        run(["git", "config", "user.email", "test@railyn.internal"]);
        run(["git", "config", "user.name", "Railyn Test"]);

        // Commit the base content for the partial-change files so HEAD exists
        // and diffs can be computed via `git diff HEAD`.
        //
        // File mix in the test worktree:
        //   Untracked / new:   feature-a.ts, feature-b.vue, feature-c.md
        //     → appear as entirely new additions (1 hunk each = "new file" diff)
        //   Tracked / partial: partial-x.ts, partial-y.ts
        //     → committed base content first, then modified — produces ≥2 disjoint
        //       hunks per file so the multi-hunk acceptance / precision tests have
        //       real data to work with.

        // --- Step 1: write and commit base content for the partial-change files ---
        const partialXBase = [
          "// partial-x.ts: committed base",
          "export function alpha() { return 1; }",
          "export function beta()  { return 2; }",
          "export function gamma() { return 3; }",
          "",
          "// middle section — unchanged",
          "export const VERSION = '1.0.0';",
          "export const NAME    = 'partial-x';",
          "",
          "export function delta()   { return 4; }",
          "export function epsilon() { return 5; }",
          "export function zeta()    { return 6; }",
        ].join("\n");

        const partialYBase = [
          "# partial-y.ts: committed base",
          "export class ServiceA {",
          "  greet() { return 'hello'; }",
          "  run()   { return 'running'; }",
          "}",
          "",
          "// stable section",
          "export const MAX_RETRIES = 3;",
          "export const TIMEOUT_MS  = 5000;",
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

        // --- Step 2: modify only the top and bottom sections (two disjoint hunks) ---
        const partialXModified = [
          "// partial-x.ts: worktree modifications",
          "export function alpha() { return 'alpha'; }",  // changed return type
          "export function beta()  { return 'beta'; }",   // changed return type
          "export function gamma() { return 'gamma'; }",  // changed return type
          "",
          "// middle section — unchanged",
          "export const VERSION = '1.0.0';",
          "export const NAME    = 'partial-x';",
          "",
          "export function delta()   { return 'delta'; }",    // changed
          "export function epsilon() { return 'epsilon'; }",  // changed
          "export function zeta()    { return 'zeta'; }",     // changed
        ].join("\n");

        const partialYModified = [
          "# partial-y.ts: worktree modifications",
          "export class ServiceA {",
          "  greet() { return 'hi there'; }",   // changed
          "  run()   { return 'active'; }",      // changed
          "}",
          "",
          "// stable section",
          "export const MAX_RETRIES = 3;",
          "export const TIMEOUT_MS  = 5000;",
          "",
          "export class ServiceB {",
          "  stop()  { return 'halted'; }",    // changed
          "  reset() { return 'cleared'; }",   // changed
          "}",
        ].join("\n");

        await Bun.write(`${worktreePath}/partial-x.ts`, partialXModified);
        await Bun.write(`${worktreePath}/partial-y.ts`, partialYModified);
        // Files are now modified but NOT staged — git diff HEAD will show them as modified.

        // --- Step 3: create the 3 untracked new-file additions ---
        const newFiles: [string, string][] = [
          ["feature-a.ts", Array.from({ length: 20 }, (_, i) => `export const lineA${i + 1} = ${i + 1};`).join("\n")],
          ["feature-b.vue", ["<template>", "  <div class=\"feature-b\">", "    <h1>Feature B</h1>", "    <p>Test component</p>", "  </div>", "</template>", "", "<script setup lang=\"ts\">", "const msg = 'hello from B';", "</script>"].join("\n")],
          ["feature-c.md", ["# Feature C", "", "This is a test markdown file.", "", "## Details", "", "- Point one", "- Point two", "- Point three"].join("\n")],
        ];
        for (const [name, content] of newFiles) {
          await Bun.write(`${worktreePath}/${name}`, content);
        }

        // Create a conversation first (tasks.create always does this — handleHumanTurn
        // will throw/deadlock if conversation_id is NULL on the task).
        const convResult = db.run("INSERT INTO conversations (task_id) VALUES (0)");
        const conversationId = convResult.lastInsertRowid as number;

        // Insert the test task — model is explicitly set to 'fake/test' so the
        // FakeAI provider resolves correctly in handleHumanTurn (avoids UnresolvableProviderError).
        db.run(
          "INSERT INTO tasks (board_id, project_id, title, description, workflow_state, execution_state, model, conversation_id) VALUES (?, ?, 'UI Test Task', 'Auto-created by test suite', 'backlog', 'idle', 'fake/test', ?)",
          [boardId, projectId, conversationId],
        );
        const taskRow = db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!;
        const taskId = taskRow.id;

        // Fix up the conversation → task back-link
        db.run("UPDATE conversations SET task_id = ? WHERE id = ?", [taskId, conversationId]);

        // Ensure the fake model is listed in enabled_models so the UI shows it.
        db.run(
          "INSERT OR IGNORE INTO enabled_models (workspace_id, qualified_model_id) VALUES (1, 'fake/test')",
        );
        // Register a second fake model so model-switching tests can change the selection.
        db.run(
          "INSERT OR IGNORE INTO enabled_models (workspace_id, qualified_model_id) VALUES (1, 'fake/v2')",
        );

        db.run(
          "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
          [taskId, worktreePath, worktreePath],
        );

        // Return all files: tracked-modified first (for partial-change suites), then new.
        const files = ["partial-x.ts", "partial-y.ts", ...newFiles.map(([name]) => name)];
        return new Response(JSON.stringify({ taskId, files, worktreePath }), { headers: { "content-type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ __error: String(e) }), { status: 500, headers: { "content-type": "application/json" } });
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

    return new Response("paths: /inspect?script=, /click?selector=, /screenshot?path=, /reset-decisions?taskId=, /test-send-message?taskId=&text=, /test-cancel?taskId=, /test-set-model?taskId=&model=, /test-compact?taskId=, /test-transition?taskId=&toState=", { status: 200 });
  },
});
if (process.env.RAILYN_DEBUG) console.log("[Debug] HTTP server listening on http://localhost:9229");

// ─── Config error: surface to UI ──────────────────────────────────────────────

if (configError) {
  // Delay to give WebView time to display the error overlay
  setTimeout(() => {
    win.webview.rpc.send["stream.error"]({
      taskId: -1,
      executionId: -1,
      error: `Config error: ${configError}`,
    });
  }, 2000);
}
