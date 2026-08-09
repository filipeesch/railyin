import { runMigrations } from "./db/migrations/runner.ts";
import { seedDefaultWorkspace } from "./db/seed.ts";
import { getDb } from "./db/index.ts";
import { loadConfig, getDataDir, getWorkspaceRegistry, markWorkflowDirSeeded, type EngineConfig, type EngineEntry } from "./config/index.ts";
import { seedWorkflows } from "./config/workflows.ts";
import { getTmpDir } from "./utils/platform.ts";
import * as path from "path";
import { getPtySession } from "./launch/pty.ts";
import { McpRegistryPool } from "./mcp/registry-pool.ts";
import { MockExecutionEngine } from "./testing/mock-engine.ts";
import { workspaceHandlers } from "./handlers/workspace.ts";
import { boardHandlers } from "./handlers/boards.ts";
import { projectHandlers } from "./handlers/projects.ts";
import { taskHandlers } from "./handlers/tasks.ts";
import { taskGitHandlers } from "./handlers/task-git.ts";
import { codeReviewHandlers } from "./handlers/code-review.ts";
import { todoHandlers } from "./handlers/todos.ts";
import { modelHandlers } from "./handlers/models.ts";
import { SqliteModelSettingsRepository } from "./db/repositories/model-settings-repository.ts";
import { engineHandlers } from "./handlers/engine.ts";
import { conversationHandlers } from "./handlers/conversations.ts";
import { workflowHandlers } from "./handlers/workflow.ts";
import { launchHandlers } from "./handlers/launch.ts";
import { lspHandlers } from "./handlers/lsp.ts";
import { codeServerHandlers } from "./handlers/code-server.ts";
import { mcpHandlers, handleMcpOAuthCallback } from "./handlers/mcp.ts";
import { chatSessionHandlers, startChatSessionAutoArchiveJob } from "./handlers/chat-sessions.ts";
import { fetchChatSessionWithModel } from "./db/task-queries.ts";
import { threadHandlers } from "./handlers/threads.ts";
import { legacyImportHandlers } from "./handlers/legacy-import.ts";
import { decisionHandlers } from "./handlers/decisions.ts";
import { noteHandlers } from "./handlers/notes.ts";
import { configHandlers } from "./handlers/config.ts";
import { Orchestrator } from "./engine/orchestrator.ts";
import { EngineRegistry } from "./engine/engine-registry.ts";
import { CopilotEngine } from "./engine/copilot/engine.ts";
import { createDefaultCopilotSdkAdapter } from "./engine/copilot/session.ts";
import { CopilotRuntime, createCopilotRuntimeHandler, type CopilotRuntimeOptions } from "@copilotkit/runtime/v2";
import { RailyinAgent } from "./copilotkit/railyin-agent.ts";
import { JsonlStore } from "./copilotkit/jsonl-store.ts";
import { RailyinAgentRunner } from "./copilotkit/railyin-runner.ts";
import * as interruptRegistry from "./copilotkit/interrupt-registry.ts";
import { ClaudeEngine } from "./engine/claude/engine.ts";
import { createDefaultClaudeSdkAdapter } from "./engine/claude/adapter.ts";
import { OpenCodeEngine } from "./engine/opencode/engine.ts";
import { createDefaultOpenCodeSdkAdapter } from "./engine/opencode/adapter.ts";
import { createPiEngine } from "./engine/pi/pi-engine-factory.ts";
import { CursorEngine, createDefaultCursorSdkAdapter } from "./engine/cursor/engine.ts";
import type { PiEngineConfig } from "./config/index.ts";
import { createDefaultDialectRegistry } from "./engine/dialects/registry.ts";
import { getWorkspaceConfig } from "./workspace-context.ts";
import { WorkspaceRepository } from "./db/workspace-repository.ts";
import { getResolvedShellEnv } from "./shell-env.ts";
import type { Task, ConversationMessage, ChatSession } from "../shared/rpc-types.ts";
import { setupFileLogging } from "./server/file-logger.ts";
import { BroadcastChannel } from "./server/broadcast-channel.ts";
import { NotificationService } from "./server/notifications.ts";
import { WebSocketHandler } from "./server/websocket.ts";
import { createShutdownHandler } from "./server/shutdown.ts";
import { ProjectResolver } from "./git/ProjectResolver.ts";
import { TaskGitContextRepository } from "./db/repositories/TaskGitContextRepository.ts";
import { GitRepositoryManager } from "./git/GitRepositoryManager.ts";
import { WorktreeManager } from "./git/WorktreeManager.ts";
import type { ExecutionEngine } from "./engine/types.ts";
import type { OnTaskUpdated } from "./engine/types.ts";

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
const modelSettingsRepo = new SqliteModelSettingsRepository(db);
const wsRepo = new WorkspaceRepository(db);

const projectResolver = new ProjectResolver();
const taskGitContextRepo = new TaskGitContextRepository(db);
const gitRepo = new GitRepositoryManager();
const worktreeManager = new WorktreeManager(db, wsRepo, projectResolver, gitRepo, taskGitContextRepo);

// 2. Load default workspace config (YAML files)
const { error: configError } = loadConfig();

// 2a. Seed workflows for every known workspace so all workspaces receive
// bundled templates on first run, not just the default workspace.
// ensureWorkspaceConfigExists only seeds brand-new workspaces; this loop
// covers pre-existing workspaces that were created before seeding was introduced.
for (const entry of getWorkspaceRegistry()) {
  const workflowsDir = path.join(entry.configDir, "workflows");
  seedWorkflows(workflowsDir);
  markWorkflowDirSeeded(workflowsDir);
}

// 2b. Start global MCP registry (non-blocking)
// The redirect URI's port is only known once the HTTP server below finishes
// binding — `boundPort` is mutated after `Bun.serve()` returns, and this
// closure is what `McpClientRegistry.authorize()` calls lazily at flow-start
// time (well after boot), so it always sees the real port.
//
// Uses the hostname `localhost` (not the `127.0.0.1` the server itself binds
// to) because several real-world authorization servers (e.g. Atlassian's
// Rovo MCP server) validate the redirect_uri's hostname against the
// `localhost` loopback convention from RFC8252 §7.3, not its IP-literal
// equivalent — the two are different strings even though both resolve to
// loopback in the browser.
let boundPort = 0;
const registryPool = new McpRegistryPool(undefined, {
  getRedirectUri: () => `http://localhost:${boundPort}/api/mcp/oauth/callback`,
});
registryPool.getGlobalRegistry().startAll().catch((err: unknown) => {
  console.error("[mcp] Failed to start MCP servers at startup:", err);
});

// ─── Notification modules ─────────────────────────────────────────────────────

const channel = new BroadcastChannel();
const notifier = new NotificationService(channel);

// ─── Engine factory map (composition root) ───────────────────────────────────

type EngineFactory = (engineId: string, cfg: EngineConfig, onTaskUpdated: OnTaskUpdated) => ExecutionEngine;

const engineFactories: Record<string, EngineFactory> = {
  copilot: (_engineId, _cfg, onTaskUpdated) =>
    new CopilotEngine(onTaskUpdated, createDefaultCopilotSdkAdapter()),
  claude: (_engineId, cfg, onTaskUpdated) =>
    new ClaudeEngine((cfg as { model?: string }).model, onTaskUpdated, createDefaultClaudeSdkAdapter()),
  opencode: (_engineId, cfg, onTaskUpdated) =>
    new OpenCodeEngine(onTaskUpdated, createDefaultOpenCodeSdkAdapter(cfg as Parameters<typeof createDefaultOpenCodeSdkAdapter>[0])),
  cursor: (_engineId, cfg, onTaskUpdated) => {
    const cursorCfg = cfg as { api_key?: string };
    return new CursorEngine(
      onTaskUpdated,
      createDefaultCursorSdkAdapter({ apiKey: cursorCfg.api_key }),
    );
  },
  pi: (engineId, cfg, onTaskUpdated) => {
    const piCfg = cfg as PiEngineConfig;
    const dialect = createDefaultDialectRegistry().create(piCfg.dialect ?? "none");
    return createPiEngine({ engineId, config: piCfg, onTaskUpdated, dialect, modelSettingsRepo });
  },
  scripted: () => new MockExecutionEngine(),
};

function buildEngineInstances(
  engines: EngineEntry[],
  factories: Record<string, EngineFactory>,
  onTaskUpdated: OnTaskUpdated,
): Map<string, ExecutionEngine> {
  const map = new Map<string, ExecutionEngine>();
  for (const entry of engines) {
    const factory = factories[entry.config.type];
    if (!factory) {
      console.warn(`[engine] No factory for engine type '${entry.config.type}' (id: ${entry.id}) — skipping.`);
      continue;
    }
    try {
      map.set(entry.id, factory(entry.id, entry.config, onTaskUpdated));
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
  // copilot and claude are always included as core fallbacks even when absent from config.
  const { config: defaultConfig } = loadConfig();
  const configEngines: EngineEntry[] = defaultConfig?.engines ?? [];
  const configIds = new Set(configEngines.map((e) => e.id));
  const coreFallbacks: EngineEntry[] = [
    { id: "copilot", config: { type: "copilot" } },
    { id: "claude", config: { type: "claude" } },
  ];
  const allEngines: EngineEntry[] = [
    ...configEngines,
    ...coreFallbacks.filter((e) => !configIds.has(e.id)),
  ];
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
  );
  engineRegistry = new EngineRegistry(instanceMap, getWorkspaceConfig);
}

// Session-status replacement push (07-01 Pitfall 2): consume() fires
// onSessionStatusChange at every chat_sessions status write; this wrapper
// broadcasts chatSession.updated so the sidebar flips running → idle without
// the removed legacy "done" push.
const sessionStatusCb = (conversationId: number): void => {
  const row = db.query<{ id: number }, [number]>(
    "SELECT id FROM chat_sessions WHERE conversation_id = ?",
  ).get(conversationId);
  if (row) {
    const session = fetchChatSessionWithModel(db, row.id);
    if (session) notifier.notifyChatSessionUpdated(session);
  }
};

const orchestrator: Orchestrator | null = !configError
  ? new Orchestrator(db, engineRegistry, notifier.onError.bind(notifier), notifier.notifyTaskUpdated.bind(notifier), wsRepo, sessionStatusCb, worktreeManager, modelSettingsRepo, registryPool)
  : null;

// ─── Start retention job ──────────────────────────────────────────────────────
const { RetentionJob } = await import("./jobs/retention-job.ts");
const retentionJob = new RetentionJob(db);
retentionJob.start();

// ─── CopilotRuntime mount (HOST-01/02) ───────────────────────────────────────
// AG-UI runtime mounted on the SAME Bun.serve origin under /api/copilotkit/*.
// - D-01: fetch-native `createCopilotRuntimeHandler` (NOT hono — decision
//   locked in phase planning; reversible one-line swap later).
// - D-02: multi-route mode under the /api/copilotkit basePath.
// - D-03: same-origin serving — NO cors option passed to the handler.
// - The ScriptedAgent probe agent is registered ONLY when RAILYN_COPILOTKIT_PROBE=1
//   (set by the e2e startServer({ copilotkitProbe }) fixture). `bun run prod`
//   never loads the e2e/ module nor registers the fake agent — env-gate pattern
//   mirroring RAILYN_TEST_EXECUTION_ENGINE above (T-1-03 mitigation). The
//   dynamic import keeps the e2e/ tree out of the production module graph.
const copilotProbeEnabled = process.env.RAILYN_COPILOTKIT_PROBE === "1";
let scriptedAgent: unknown;
if (copilotProbeEnabled) {
  const probeModule = await import("../../e2e/api/copilotkit/probe-agent.ts");
  scriptedAgent = probeModule.scriptedAgent;
}
// D-12: when the probe is disabled AND the orchestrator exists (config loaded
// cleanly), register RailyinAgent — the real AG-UI bridge. The probe gate is
// checked FIRST (Pitfall 9): `bun run prod` never loads the e2e probe module.
let railyinAgent: unknown = null;
if (!copilotProbeEnabled && orchestrator) {
  railyinAgent = new RailyinAgent(db, orchestrator);
}
// The runtime's AgentsConfig references its NESTED @ag-ui/client AbstractAgent
// (nested rxjs@7.8.1), while the probe/railyin agent extends the top-level copy
// (rxjs@7.8.2). Structurally identical at runtime — the probe tests prove the
// round-trip end-to-end — but rxjs's Subscriber is invariant, so the types do
// not unify. The cast bridges only that type-level gap; the agents map stays
// empty in `bun run prod` when the orchestrator failed to construct (config
// error — the runtime mount is inert without an execution surface).
type CopilotAgents = CopilotRuntimeOptions["agents"];
const copilotAgents = (copilotProbeEnabled && scriptedAgent
  ? { default: scriptedAgent }
  : railyinAgent
    ? { default: railyinAgent }
    : {}) as unknown as CopilotAgents;
// 02-02 (D-12 runner swap, RUNR-02): the durable RailyinAgentRunner persists
// every wire event to `data/threads/{threadId}.jsonl` and replays cold
// connects from the log. The runner is used ONLY in the non-probe path —
// probe mode keeps the base InMemoryAgentRunner so ScriptedAgent wire text
// stays byte-identical (probe threadIds like "t1" are non-numeric and must
// never reach the JSONL store).
const jsonlStore = new JsonlStore(getDataDir());
// 03-03 (A2): give the module-level interrupt registry the durable store so a
// fresh process can lazily rebuild a pending decision from the thread's JSONL
// tail + the waiting_user executions row (post-restart resume — old-stack
// parity). Gated to the non-probe path: probe threadIds ("t1") are non-numeric
// and must never reach the store's validation.
if (!copilotProbeEnabled) interruptRegistry.configure({ store: jsonlStore });
const railyinRunner = !copilotProbeEnabled ? new RailyinAgentRunner(jsonlStore) : undefined;
const copilotRuntime = new CopilotRuntime({
  agents: copilotAgents,
  ...(railyinRunner ? { runner: railyinRunner } : {}),
});
const copilotHandler = createCopilotRuntimeHandler({
  runtime: copilotRuntime,
  basePath: "/api/copilotkit",
  mode: "multi-route",
});

// ─── Bun HTTP + WebSocket server ──────────────────────────────────────────────

const DIST_DIR = path.join(import.meta.dir, "../../dist");

const portArg = process.argv.find(a => a.startsWith("--port="));
const serverPort = portArg ? Number(portArg.split("=")[1]) : 3000;

const allHandlers = {
  ...workspaceHandlers(db),
  ...boardHandlers(db),
  ...projectHandlers(),
  ...taskHandlers(db, wsRepo, orchestrator, notifier.notifyTaskUpdated.bind(notifier), worktreeManager, modelSettingsRepo),
  ...taskGitHandlers(db, notifier.notifyTaskUpdated.bind(notifier), worktreeManager, gitRepo),
  ...codeReviewHandlers(db),
  ...todoHandlers(db),
  ...modelHandlers(db, orchestrator, modelSettingsRepo),
  ...engineHandlers(orchestrator),
  ...conversationHandlers(db, orchestrator, modelSettingsRepo),
  ...workflowHandlers(db, notifier.notifyWorkflowReloaded.bind(notifier)),
  ...launchHandlers(db),
  ...lspHandlers(db, wsRepo, undefined, undefined, channel.broadcast.bind(channel)),
  ...codeServerHandlers(db, channel.broadcast.bind(channel), serverPort),
  ...mcpHandlers(db, {
    registryPool,
    resolveProject: (workspaceKey: string, projectKey: string) => {
      const cfg = getWorkspaceConfig(workspaceKey);
      return cfg?.projects?.find((p) => p.key === projectKey) ?? null;
    },
  }),
  ...chatSessionHandlers(db, notifier.notifyChatSessionUpdated.bind(notifier), orchestrator),
  ...threadHandlers(db, jsonlStore),
  ...legacyImportHandlers(db, jsonlStore),
  ...decisionHandlers(db),
  ...noteHandlers(db),
  ...configHandlers(),
} as Record<string, (params: unknown) => unknown>;

const wsHandler = new WebSocketHandler(channel, getPtySession);

/**
 * WR-03: same-origin gate for the unauthenticated AG-UI execution mount
 * (/api/copilotkit/*). The mount drives REAL engines — including their
 * shell/bash tools — from an attacker-chosen prompt, so a cross-origin
 * browser POST (DNS rebinding / CSRF) must never reach it. Browsers send
 * `Origin` on every POST (same- AND cross-origin): a mismatch with the
 * server's own Host is rejected with 403. Requests WITHOUT an Origin header
 * (curl, native clients, Node fetch, same-origin EventSource GETs) pass —
 * this is a local single-user app and the header is only meaningful for
 * browser-originated requests.
 */
function isSameOriginRequest(req: Request, url: URL): boolean {
  const origin = req.headers.get("origin");
  if (origin == null) return true; // non-browser client — nothing to verify
  try {
    const originUrl = new URL(origin);
    return originUrl.host === (req.headers.get("host") ?? url.host);
  } catch {
    return false; // unparseable Origin (e.g. "null" from sandboxed frames) → reject
  }
}

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

    if (req.method === "GET" && url.pathname === "/api/mcp/oauth/callback") {
      return handleMcpOAuthCallback(url, registryPool);
    }

    // /api/copilotkit/* — CopilotRuntime mount (HOST-01). MUST precede the
    // POST /api/ RPC router below (Pitfall 3: the RPC router would 404 these
    // paths). Deliberately NOT wrapped in the RPC try/catch — it JSON-encodes
    // errors and would corrupt SSE streams. HOST-02: disable the per-request
    // idle timeout for runtime paths only (SSE streams go quiet > global
    // idleTimeout 30s during agent silences); the global idleTimeout stays for
    // the rest of the app.
    if (url.pathname.startsWith("/api/copilotkit/")) {
      // WR-03: reject cross-origin browser requests before they reach the
      // runtime (403, not SSE) — see isSameOriginRequest above.
      if (!isSameOriginRequest(req, url)) {
        return new Response(JSON.stringify({ error: "Cross-origin request rejected" }), {
          status: 403,
          headers: { "content-type": "application/json" },
        });
      }
      srv.timeout(req, 0);
      return copilotHandler(req);
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
boundPort = server.port ?? serverPort;
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
