import { BrowserWindow, BrowserView } from "electrobun/bun";
import { runMigrations, seedDefaultWorkspace } from "./db/migrations.ts";
import { getDb } from "./db/index.ts";
import { loadConfig } from "./config/index.ts";
import { workspaceHandlers } from "./handlers/workspace.ts";
import { boardHandlers } from "./handlers/boards.ts";
import { projectHandlers } from "./handlers/projects.ts";
import { taskHandlers } from "./handlers/tasks.ts";
import { conversationHandlers } from "./handlers/conversations.ts";
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

function onToken(taskId: number, executionId: number, token: string, done: boolean, isReasoning?: boolean): void {
  win.webview.rpc.send["stream.token"]({ taskId, executionId, token, done, isReasoning });
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

// ─── Wire up RPC handlers ─────────────────────────────────────────────────────

const mainWebviewRPC = BrowserView.defineRPC<RailynRPCType>({
  handlers: {
    requests: {
      ...workspaceHandlers(),
      ...boardHandlers(),
      ...projectHandlers(),
      ...taskHandlers(onToken, onError, notifyTaskUpdated, notifyNewMessage),
      ...conversationHandlers(),
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
