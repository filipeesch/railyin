import { BrowserWindow, BrowserView } from "electrobun/bun";
import { runMigrations, seedDefaultWorkspace } from "./db/migrations.ts";
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
    messages: {},
  },
});

// ─── App window ──────────────────────────────────────────────────────────────

win = new BrowserWindow({
  url: "views://mainview/index.html",
  title: "Railyn",
  frame: { width: 1400, height: 900 },
  rpc: mainWebviewRPC,
});

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
