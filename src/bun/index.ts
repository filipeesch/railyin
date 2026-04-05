import { BrowserWindow, BrowserView } from "electrobun/bun";
import { runMigrations, seedDefaultWorkspace } from "./db/migrations.ts";
import { getDb } from "./db/index.ts";
import { loadConfig } from "./config/index.ts";
import { workspaceHandlers } from "./handlers/workspace.ts";
import { boardHandlers } from "./handlers/boards.ts";
import { projectHandlers } from "./handlers/projects.ts";
import { taskHandlers } from "./handlers/tasks.ts";
import { conversationHandlers } from "./handlers/conversations.ts";
import { workflowHandlers } from "./handlers/workflow.ts";
import type { RailynRPCType } from "../shared/rpc-types.ts";
import type { Task, ConversationMessage } from "../shared/rpc-types.ts";

// ─── Bootstrap ───────────────────────────────────────────────────────────────

// 1. Load config (YAML files)
const { error: configError } = loadConfig();

// 2. Run DB migrations + seed default workspace
runMigrations();
seedDefaultWorkspace();

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

const mainWebviewRPC = BrowserView.defineRPC<RailynRPCType>({
  handlers: {
    requests: {
      ...workspaceHandlers(),
      ...boardHandlers(),
      ...projectHandlers(),
      ...taskHandlers(onToken, onError, notifyTaskUpdated, notifyNewMessage),
      ...conversationHandlers(),
      ...workflowHandlers(notifyWorkflowReloaded),
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

// ─── Debug HTTP server (dev only) ────────────────────────────────────────────
// curl "http://localhost:9229/inspect?script=return+JSON.stringify(document.querySelector('.hunk-btn--accept')?.getBoundingClientRect())"
// curl "http://localhost:9229/click?selector=.hunk-btn--accept"

const _debugServer = Bun.serve({
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

    // Test-only: delete all hunk decisions for a task so tests start from a clean state.
    if (url.pathname === "/reset-decisions") {
      const taskId = url.searchParams.get("taskId");
      if (!taskId) return new Response(JSON.stringify({ __error: "taskId required" }), { status: 400, headers: { "content-type": "application/json" } });
      const db = getDb();
      db.run("DELETE FROM task_hunk_decisions WHERE task_id = ?", [parseInt(taskId, 10)]);
      return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
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
        const prev = db.query<{ id: number }, []>("SELECT id FROM tasks WHERE title = 'UI Test Task' LIMIT 1").get();
        if (prev) {
          db.run("DELETE FROM task_hunk_decisions WHERE task_id = ?", [prev.id]);
          db.run("DELETE FROM task_git_context WHERE task_id = ?", [prev.id]);
          db.run("DELETE FROM tasks WHERE id = ?", [prev.id]);
        }

        // Resolve stable required IDs (board + project) from an existing task.
        const existingTask = db.query<{ board_id: number; project_id: number }, []>("SELECT board_id, project_id FROM tasks WHERE title != 'UI Test Task' LIMIT 1").get();
        if (!existingTask) return new Response(JSON.stringify({ __error: "No existing task found. Open the app, create a project and task first." }), { status: 500, headers: { "content-type": "application/json" } });
        const board = { id: existingTask.board_id, project_id: existingTask.project_id };

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

        // Commit an empty initial state so HEAD exists (required for git diff HEAD to work).
        run(["git", "commit", "--allow-empty", "-m", "initial"]);

        // Create 3 test files as new (untracked) additions — each becomes 1 hunk.
        const testFiles: [string, string][] = [
          ["feature-a.ts", Array.from({ length: 20 }, (_, i) => `export const lineA${i + 1} = ${i + 1};`).join("\n")],
          ["feature-b.vue", ["<template>", "  <div class=\"feature-b\">", "    <h1>Feature B</h1>", "    <p>Test component</p>", "  </div>", "</template>", "", "<script setup lang=\"ts\">", "const msg = 'hello from B';", "</script>"].join("\n")],
          ["feature-c.md", ["# Feature C", "", "This is a test markdown file.", "", "## Details", "", "- Point one", "- Point two", "- Point three"].join("\n")],
        ];

        for (const [name, content] of testFiles) {
          await Bun.write(`${worktreePath}/${name}`, content);
        }

        // Insert the test task.
        db.run(
          "INSERT INTO tasks (board_id, project_id, title, description, workflow_state, execution_state) VALUES (?, ?, 'UI Test Task', 'Auto-created by test suite', 'backlog', 'idle')",
          [board.id, board.project_id],
        );
        const taskRow = db.query<{ id: number }, []>("SELECT last_insert_rowid() AS id").get()!;
        const taskId = taskRow.id;

        db.run(
          "INSERT INTO task_git_context (task_id, git_root_path, worktree_path, worktree_status) VALUES (?, ?, ?, 'ready')",
          [taskId, worktreePath, worktreePath],
        );

        const files = testFiles.map(([name]) => name);
        return new Response(JSON.stringify({ taskId, files, worktreePath }), { headers: { "content-type": "application/json" } });
      } catch (e) {
        return new Response(JSON.stringify({ __error: String(e) }), { status: 500, headers: { "content-type": "application/json" } });
      }
    }

    return new Response("paths: /inspect?script=, /click?selector=, /screenshot?path=, /reset-decisions?taskId=", { status: 200 });
  },
});
console.log("[Debug] HTTP server listening on http://localhost:9229");

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
