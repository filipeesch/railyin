import { runMigrations } from "./db/migrations/runner.ts";
import { seedDefaultWorkspace } from "./db/seed.ts";
import { getDb } from "./db/index.ts";
import { loadConfig, getDataDir, type EngineConfig, type EngineEntry } from "./config/index.ts";
import { getTmpDir } from "./utils/platform.ts";
import * as path from "path";
import { getPtySession } from "./launch/pty.ts";
import { initMcpRegistry } from "./mcp/registry.ts";
import type { McpConfig, McpServerConfig } from "./mcp/types.ts";
import { MockExecutionEngine } from "./testing/mock-engine.ts";
import { workspaceHandlers } from "./handlers/workspace.ts";
import { boardHandlers } from "./handlers/boards.ts";
import { projectHandlers } from "./handlers/projects.ts";
import { taskHandlers } from "./handlers/tasks.ts";
import { taskGitHandlers } from "./handlers/task-git.ts";
import { codeReviewHandlers } from "./handlers/code-review.ts";
import { todoHandlers } from "./handlers/todos.ts";
import { modelHandlers } from "./handlers/models.ts";
import { engineHandlers } from "./handlers/engine.ts";
import { conversationHandlers } from "./handlers/conversations.ts";
import { workflowHandlers } from "./handlers/workflow.ts";
import { launchHandlers } from "./handlers/launch.ts";
import { lspHandlers } from "./handlers/lsp.ts";
import { codeServerHandlers } from "./handlers/code-server.ts";
import { mcpHandlers } from "./handlers/mcp.ts";
import { chatSessionHandlers, startChatSessionAutoArchiveJob } from "./handlers/chat-sessions.ts";
import { decisionHandlers } from "./handlers/decisions.ts";
import { Orchestrator } from "./engine/orchestrator.ts";
import { EngineRegistry } from "./engine/engine-registry.ts";
import { CopilotEngine } from "./engine/copilot/engine.ts";
import { createDefaultCopilotSdkAdapter } from "./engine/copilot/session.ts";
import { ClaudeEngine } from "./engine/claude/engine.ts";
import { createDefaultClaudeSdkAdapter } from "./engine/claude/adapter.ts";
import { OpenCodeEngine } from "./engine/opencode/engine.ts";
import { createDefaultOpenCodeSdkAdapter } from "./engine/opencode/adapter.ts";
import { PiEngine } from "./engine/pi/engine.ts";
import type { PiEngineConfig } from "./config/index.ts";
import { getWorkspaceConfig } from "./workspace-context.ts";
import { WorkspaceRepository } from "./db/workspace-repository.ts";
import { getResolvedShellEnv } from "./shell-env.ts";
import type { Task, ConversationMessage, ChatSession } from "../shared/rpc-types.ts";
import { setupFileLogging } from "./server/file-logger.ts";
import { BroadcastChannel } from "./server/broadcast-channel.ts";
import { NotificationService } from "./server/notifications.ts";
import { StreamEventProcessor } from "./server/stream-processor.ts";
import { WebSocketHandler } from "./server/websocket.ts";
import { createShutdownHandler } from "./server/shutdown.ts";
import { ProjectResolver } from "./git/ProjectResolver.ts";
import { TaskGitContextRepository } from "./db/repositories/TaskGitContextRepository.ts";
import { GitRepositoryManager } from "./git/GitRepositoryManager.ts";
import { WorktreeManager } from "./git/WorktreeManager.ts";
import type { ExecutionEngine } from "./engine/types.ts";
import type { OnTaskUpdated, OnNewMessage } from "./engine/types.ts";

// ─── File logging (canary/production: no terminal to read) ───────────────────
setupFileLogging();

// ─── Global error handlers ────────────────────────────────────────────────────
process.on("unhandledRejection", (reason) => {
  console.error("[railyin] Unhandled rejection:", reason instanceof Error ? reason.stack ?? reason.message : reason);
});
process.on("uncaughtException", (err) => {
  console.error("[railyin] Uncaught exception:", err instanceof Error ? err.stack ?? err.message : err);
});

// ─── CLI flags ────────────────────────────────────────────────────────────────
declare const __RAILYN_FORCE_DEBUG__: boolean | undefined;
declare const __RAILYN_FORCE_MEMORY_DB__: boolean | undefined;

const argv = process.argv.slice(2);
if (typeof __RAILYN_FORCE_DEBUG__ !== "undefined" && __RAILYN_FORCE_DEBUG__) process.env.RAILYN_DEBUG = "1";
if (typeof __RAILYN_FORCE_MEMORY_DB__ !== "undefined" && __RAILYN_FORCE_MEMORY_DB__) process.env.RAILYN_DB = ":memory:";
if (argv.includes("--memory-db")) process.env.RAILYN_DB = ":memory:";

// ─── Bootstrap ───────────────────────────────────────────────────────────────

// 0. Resolve shell environment at startup (captures user PATH from login shell)
await getResolvedShellEnv();

// 1. Run DB migrations, sync config-backed rows, then seed any test-only defaults.
await runMigrations();
seedDefaultWorkspace();

const db = getDb();
const wsRepo = new WorkspaceRepository(db);

const projectResolver = new ProjectResolver();
const taskGitContextRepo = new TaskGitContextRepository(db);
const gitRepo = new GitRepositoryManager();
const worktreeManager = new WorktreeManager(db, wsRepo, projectResolver, gitRepo, taskGitContextRepo);

// 2. Load default workspace config (YAML files)
const { error: configError } = loadConfig();

// 2b. Load MCP config from ~/.railyn/mcp.json and start registry (non-blocking)
async function loadMcpConfig(): Promise<void> {
  const { existsSync, readFileSync } = await import("fs");
  const { join } = await import("path");
  const mcpConfigPath = join(getDataDir(), "mcp.json");
  if (!existsSync(mcpConfigPath)) return;
  try {
    const raw = readFileSync(mcpConfigPath, "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    let mcpConfig: McpConfig;
    if (!parsed.servers) {
      mcpConfig = { servers: [] };
    } else if (Array.isArray(parsed.servers)) {
      mcpConfig = { servers: parsed.servers as McpServerConfig[] };
    } else {
      const servers: McpServerConfig[] = Object.entries(parsed.servers as Record<string, unknown>).map(
        ([name, entry]) => {
          const e = entry as Record<string, unknown>;
          const transport = e.url
            ? { type: "http" as const, url: e.url as string, headers: e.headers as Record<string, string> | undefined }
            : { type: "stdio" as const, command: e.command as string, args: e.args as string[] | undefined, env: e.env as Record<string, string> | undefined };
          return { name, transport };
        }
      );
      mcpConfig = { servers };
    }
    const registry = initMcpRegistry(mcpConfig);
    registry.startAll().catch((err: unknown) => {
      console.error("[mcp] Failed to start MCP servers at startup:", err);
    });
    console.log(`[mcp] Loaded ${mcpConfig.servers.length} MCP server(s) from ${mcpConfigPath}`);
  } catch (err) {
    console.error("[mcp] Failed to load mcp.json at startup:", err);
  }
}
await loadMcpConfig();

// 3. Reset any tasks/executions stuck in 'running'/'waiting_user' from last session
function resetStuckTasks(): void {
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
resetStuckTasks();

// ─── Notification modules ─────────────────────────────────────────────────────
const channel = new BroadcastChannel();
const notifier = new NotificationService(channel);
const streamProc = new StreamEventProcessor(channel, db);

// ─── Engine factory map (composition root) ───────────────────────────────────

type EngineFactory = (cfg: EngineConfig, onTaskUpdated: OnTaskUpdated, onNewMessage: OnNewMessage) => ExecutionEngine;

const engineFactories: Record<string, EngineFactory> = {
  copilot: (_cfg, onTaskUpdated, onNewMessage) =>
    new CopilotEngine(onTaskUpdated, onNewMessage, createDefaultCopilotSdkAdapter()),
  claude: (cfg, onTaskUpdated, onNewMessage) =>
    new ClaudeEngine((cfg as { model?: string }).model, onTaskUpdated, onNewMessage, createDefaultClaudeSdkAdapter()),
  opencode: (cfg, onTaskUpdated, onNewMessage) =>
    new OpenCodeEngine(onTaskUpdated, onNewMessage, createDefaultOpenCodeSdkAdapter(cfg as Parameters<typeof createDefaultOpenCodeSdkAdapter>[0])),
  pi: (cfg, onTaskUpdated, onNewMessage) =>
    new PiEngine(cfg as PiEngineConfig, onTaskUpdated, onNewMessage),
  scripted: () => new MockExecutionEngine(),
};

function buildEngineInstances(
  engines: EngineEntry[],
  factories: Record<string, EngineFactory>,
  onTaskUpdated: OnTaskUpdated,
  onNewMessage: OnNewMessage,
): Map<string, ExecutionEngine> {
  const map = new Map<string, ExecutionEngine>();
  for (const entry of engines) {
    const factory = factories[entry.config.type];
    if (!factory) {
      console.warn(`[engine] No factory for engine type '${entry.config.type}' (id: ${entry.id}) — skipping.`);
      continue;
    }
    try {
      map.set(entry.id, factory(entry.config, onTaskUpdated, onNewMessage));
    } catch (err) {
      console.error(`[engine] Failed to construct engine '${entry.id}':`, err);
    }
  }
  return map;
}

// ─── Engine + Orchestrator ────────────────────────────────────────────────────
const injectedEngine = process.env.RAILYN_TEST_EXECUTION_ENGINE === "mock"
  ? new MockExecutionEngine()
  : null;

let engineRegistry: EngineRegistry;

if (injectedEngine) {
  const mockMap = new Map<string, ExecutionEngine>([["scripted", injectedEngine]]);
  engineRegistry = new EngineRegistry(mockMap, getWorkspaceConfig);
} else {
  // Collect all unique engines across all workspaces, deduplicated by id.
  // In practice, engines.yaml is global so a single-pass over the default workspace is enough.
  const { config: defaultConfig } = loadConfig();
  const allEngines: EngineEntry[] = defaultConfig?.engines ?? [];
  const seenIds = new Set<string>();
  const uniqueEngines = allEngines.filter((e) => {
    if (seenIds.has(e.id)) return false;
    seenIds.add(e.id);
    return true;
  });

  const instanceMap = buildEngineInstances(
    uniqueEngines,
    engineFactories,
    notifier.notifyTaskUpdated.bind(notifier),
    notifier.notifyNewMessage.bind(notifier),
  );
  engineRegistry = new EngineRegistry(instanceMap, getWorkspaceConfig);
}

const orchestrator: Orchestrator | null = !configError
  ? new Orchestrator(db, engineRegistry, notifier.onError.bind(notifier), notifier.notifyTaskUpdated.bind(notifier), notifier.notifyNewMessage.bind(notifier), wsRepo, streamProc.onRawMessageEnqueued.bind(streamProc), worktreeManager)
  : null;

if (orchestrator) {
  orchestrator.setOnStreamEvent(streamProc.onStreamEvent.bind(streamProc));
  // Late-bind: resolves the circular dependency (orchestrator needs streamProc, streamProc needs orchestrator)
  streamProc.setMarkClaudeExecution((id) => orchestrator.markClaudeExecution(id));
}

streamProc.start();

// ─── Start retention job ──────────────────────────────────────────────────────
const { RetentionJob } = await import("./jobs/retention-job.ts");
const retentionJob = new RetentionJob(db);
retentionJob.start();

// ─── Bun HTTP + WebSocket server ──────────────────────────────────────────────

const DIST_DIR = path.join(import.meta.dir, "../../dist");

const portArg = process.argv.find(a => a.startsWith("--port="));
const serverPort = portArg ? Number(portArg.split("=")[1]) : 3000;

const allHandlers = {
  ...workspaceHandlers(db),
  ...boardHandlers(db),
  ...projectHandlers(),
  ...taskHandlers(db, wsRepo, orchestrator, notifier.notifyTaskUpdated.bind(notifier), worktreeManager),
  ...taskGitHandlers(db, notifier.notifyTaskUpdated.bind(notifier), worktreeManager, gitRepo),
  ...codeReviewHandlers(db),
  ...todoHandlers(db),
  ...modelHandlers(db, orchestrator),
  ...engineHandlers(orchestrator),
  ...conversationHandlers(db, orchestrator),
  ...workflowHandlers(notifier.notifyWorkflowReloaded.bind(notifier)),
  ...launchHandlers(db),
  ...lspHandlers(db, wsRepo, undefined, undefined, channel.broadcast.bind(channel)),
  ...codeServerHandlers(db, channel.broadcast.bind(channel), serverPort),
  ...mcpHandlers(db),
  ...chatSessionHandlers(db, notifier.notifyChatSessionUpdated.bind(notifier), orchestrator),
  ...decisionHandlers(db),
} as Record<string, (params: unknown) => unknown>;

const wsHandler = new WebSocketHandler(channel, getPtySession);

const server = Bun.serve({
  hostname: "127.0.0.1",
  port: serverPort,
  idleTimeout: 30,

  async fetch(req, srv) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") {
      const upgraded = srv.upgrade(req, { data: { type: "push" } });
      if (!upgraded) return new Response("WS upgrade failed", { status: 500 });
      return undefined as unknown as Response;
    }

    if (url.pathname.startsWith("/ws/pty/")) {
      const sessionId = url.pathname.slice(8);
      const upgraded = srv.upgrade(req, { data: { type: "pty", sessionId } });
      if (!upgraded) return new Response("WS upgrade failed", { status: 500 });
      return undefined as unknown as Response;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/")) {
      const method = url.pathname.slice(5);
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
        return new Response(JSON.stringify(result ?? null), {
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

    let filePath = path.join(DIST_DIR, url.pathname === "/" ? "index.html" : url.pathname);
    let file = Bun.file(filePath);
    if (!(await file.exists())) {
      filePath = path.join(DIST_DIR, "index.html");
      file = Bun.file(filePath);
    }
    if (!(await file.exists())) {
      return new Response("Not found", { status: 404 });
    }
    return new Response(file);
  },

  websocket: wsHandler,
});

await Bun.write(path.join(getTmpDir(), "railyn.port"), String(server.port)).catch(() => { });
console.log(`Railyn server listening on http://127.0.0.1:${server.port}`);

// ─── Graceful shutdown ────────────────────────────────────────────────────────
const { shutdown } = createShutdownHandler(orchestrator);
process.on("SIGTERM", () => { void shutdown(); });
process.on("SIGINT", () => { void shutdown(); });

// Start chat session auto-archive job (archives sessions idle for 7+ days)
startChatSessionAutoArchiveJob(db, notifier.notifyChatSessionUpdated.bind(notifier));

// ─── Debug server (only when RAILYN_DEBUG=1) — /shutdown endpoint for e2e tests ─
if (process.env.RAILYN_DEBUG) {
  const debugServer = Bun.serve({
    port: 0,
    idleTimeout: 30,
    fetch(req: Request) {
      const url = new URL(req.url);
      if (url.pathname === "/shutdown") {
        setTimeout(() => process.exit(0), 50);
        return new Response(JSON.stringify({ ok: true }), { headers: { "content-type": "application/json" } });
      }
      return new Response("paths: /shutdown", { status: 200 });
    },
  });
  Bun.write(path.join(getTmpDir(), "railyn-debug.port"), String(debugServer.port)).catch(() => { });
  console.log(`DEBUG_PORT=${debugServer.port}`);
}

// ─── Config error: push to connected clients ──────────────────────────────────
if (configError) {
  setTimeout(() => {
    notifier.broadcastConfigError({
      taskId: -1,
      executionId: -1,
      error: `Config error: ${configError}`,
    });
  }, 2000);
}
