# Phase 1: CopilotRuntime Hosting & Thread APIs (Spike) — Pattern Map

**Mapped:** 2026-08-08
**Files analyzed:** 9 (4 new, 5 modified)
**Analogs found:** 6 with match / 9 (3 partial)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/bun/index.ts` (EDIT) | config / composition root | request-response + streaming | itself — existing prefix-dispatch fetch handler (lines 286–341) | self-analog |
| `e2e/api/fixtures/server.ts` (EDIT) | fixture (probe spawn) | request-response | itself — `StartServerOptions.mcpConfig` → `extraEnv` mechanism (lines 133–140) | self-analog |
| `e2e/api/copilotkit/probe-agent.ts` (NEW) | test fixture (test double) | event-driven (async generator) | `src/bun/testing/mock-engine.ts` (`MockExecutionEngine`) | exact |
| `e2e/api/copilotkit/copilotkit.test.ts` (NEW) | test (integration) | request-response + streaming | `e2e/api/smoke.test.ts` + raw-fetch pattern from `e2e/api/mcp-oauth.test.ts` | exact |
| `e2e/api/copilotkit/sse-text-diff.test.ts` (NEW) | test (integration, fixture validation) | streaming + transform | `e2e/api/smoke.test.ts` structure; diff assertion has no analog (research Pattern 3) | role-match |
| `e2e/api/copilotkit/capture-real.ts` (NEW) | script / utility | transform (SSE capture → dump) | `scripts/postinstall.ts` (standalone bun script shape) + `startServer()` fixture | partial |
| `e2e/api/copilotkit/pins.test.ts` (NEW) | test (unit) | static | `e2e/api/mcp-oauth.test.ts` node:fs file reads; `smoke.test.ts` describe/test shape | partial |
| `e2e/ui/fixtures/mock-agui.ts` (NEW) | fixture (mock) | streaming (SSE) | `e2e/ui/fixtures/mock-ws.ts` (`WsMock` — queue/push/install) + `mock-api.ts` route dispatch | role-match |
| `e2e/ui/fixtures/mock-api.ts` (EDIT) | fixture (mock) | request-response | itself — route dispatcher (lines 79–117) | self-analog |
| `package.json` (EDIT) | config | static | existing exact pin `"@anthropic-ai/claude-agent-sdk": "0.3.204"` (line 28) | exact |
| `.planning/PROJECT.md` (EDIT) | documentation | static | itself — Key Decisions table (lines 67–82), Context bullets (48–57), footer (line 102) | self-analog |

## Pattern Assignments

### `src/bun/index.ts` (composition root — EDIT)

**Analog:** itself. Copy the existing prefix-dispatch structure of the `fetch(req, srv)` handler; insert the copilotkit branch **before** the `POST /api/` RPC router (Pitfall 3 — RPC would 404 unknown paths).

**Existing prefix-dispatch pattern** (lines 289–329) — the mount must follow this exact shape:
```typescript
async fetch(req, srv) {
    const url = new URL(req.url);

    if (url.pathname === "/ws") { ... }                              // line 289
    if (url.pathname.startsWith("/ws/pty/")) { ... }                 // line 295
    if (req.method === "GET" && url.pathname === "/api/mcp/oauth/callback") {  // line 302
      return handleMcpOAuthCallback(url, registryPool);
    }
    // ← INSERT copilotkit branch HERE, before the /api/ router:
    //   if (url.pathname.startsWith("/api/copilotkit/")) {
    //     srv.timeout(req, 0);            // HOST-02: disable idle timeout for SSE
    //     return copilotHandler(req);     // createCopilotRuntimeHandler (D-01/D-02)
    //   }
    if (req.method === "POST" && url.pathname.startsWith("/api/")) { // line 306 — RPC router
      const method = url.pathname.slice(5);
      const handler = allHandlers[method];
      if (!handler) { return 404 JSON }                              // line 309-314
      try { ... } catch (err) { return 500 JSON }                    // lines 315-328
    }
    ...
}
```

**Bun.serve config** (lines 281–284) — keep `idleTimeout: 30` global; the per-request override is the mitigation, not the global:
```typescript
const server = Bun.serve({
  hostname: "127.0.0.1",
  port: serverPort,
  idleTimeout: 30,   // keep — copilotkit paths get srv.timeout(req, 0) instead
```

**Env-gated test-only injection** (lines 187–189) — the ScriptedAgent must be registered ONLY under a probe flag (`RAILYN_COPILOTKIT_PROBE=1`), exactly like the existing mock-engine gate:
```typescript
const injectedEngine = process.env.RAILYN_TEST_EXECUTION_ENGINE === "mock"
  ? new MockExecutionEngine()
  : null;
```

**Imports placement:** handler construction belongs near the other composition-root wiring (engine factory map, lines 141–162). Verified research API (01-RESEARCH.md §Code Examples §Mounting): `import { CopilotRuntime, createCopilotRuntimeHandler } from "@copilotkit/runtime/v2";` with `new CopilotRuntime({ agents: { default: scriptedAgent } })` and `createCopilotRuntimeHandler({ runtime, basePath: "/api/copilotkit", mode: "multi-route" })` — no `cors` (D-03 same-origin).

**Error-handling note:** copilotkit branches return the runtime's own Responses — do NOT wrap in the RPC try/catch (which JSON-encodes and would corrupt SSE).

---

### `e2e/api/fixtures/server.ts` (probe spawn — EDIT)

**Analog:** itself. The `StartServerOptions.mcpConfig` → `extraEnv` mechanism is the established seam for per-test server configuration. The copilotkit probe needs `RAILYN_COPILOTKIT_PROBE=1` passed to the subprocess so `index.ts` registers the ScriptedAgent.

**Option extension pattern** (lines 22–32 + 133–140):
```typescript
export interface StartServerOptions {
    mcpConfig?: object;
    // ADD (planner discretion): copilotkitProbe?: boolean → sets extraEnv.RAILYN_COPILOTKIT_PROBE = "1"
}

// inside startServer(), before spawn (lines 133–140):
let dataDir = "";
const extraEnv: Record<string, string> = {};
if (options?.mcpConfig !== undefined) { ... extraEnv.RAILYN_DATA_DIR = dataDir; }
// ADD: if (options?.copilotkitProbe) extraEnv.RAILYN_COPILOTKIT_PROBE = "1";
```

**Spawn pattern** (lines 142–168) — reuse unchanged: `spawn({ cmd: ["bun", "--define", ..., "src/bun/index.ts", "--memory-db", "--port=0"], cwd: ROOT, env: { ...process.env, RAILYN_DEBUG: "1", RAILYN_WORKSPACES_DIR: ..., RAILYN_TEST_EXECUTION_ENGINE: "mock", ...extraEnv }, stdout: "pipe", stderr: "pipe" })`.

**Port-from-stdout parse** (lines 185–231) — unchanged; `baseUrl` (line 233) is what the probe's raw fetch uses.

---

### `e2e/api/copilotkit/probe-agent.ts` (ScriptedAgent — NEW)

**Analog:** `src/bun/testing/mock-engine.ts` — exact match (scripted deterministic async-generator producer, delay pacing, abort checks).

**Core pattern to copy** (mock-engine.ts lines 10–37) — the `delay()` helper and async-generator shape:
```typescript
// mock-engine.ts lines 10–12 — pacing helper
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// mock-engine.ts lines 18–37 — deterministic async generator
async *execute(params: ExecutionParams): AsyncIterable<EngineEvent> {
  const response = `Mock response: ${params.prompt}`;
  ...
  for (const chunk of chunks) {
    if (params.signal.aborted || this.cancelled.has(params.executionId)) return;
    await delay(10);
    yield { type: "token", content: chunk };
  }
  yield { type: "done" };
}
```

**Adaptation for AG-UI** (research §Code Examples §ScriptedAgent — the ScriptedAgent must differ from MockExecutionEngine in three ways):
1. Extend `AbstractAgent` from `@ag-ui/client` (constructor `super({ agentId: "default", ... })`) — the runtime's `cloneAgentForRequest` requires it.
2. Emit `RUN_STARTED` **first** — the runtime does NOT synthesize it; client `verifyEvents` rejects streams that start otherwise (Pitfall 2). Lifecycle: `RUN_STARTED` → `TEXT_MESSAGE_START/CONTENT/END` → optional `silenceMs` pause (HOST-02, use the `delay()` helper) → `RUN_FINISHED`.
3. Keep a script queue / `silenceMs` option on the class, mirroring mock-engine's cancellation-aware loop.

**Test-double file conventions:** file lives in `e2e/api/copilotkit/` (spike probe code must NOT pollute production `src/bun/` — CONTEXT.md discretion). Note: research's canonical example imports it in `src/bun/index.ts` — the env-gated import there may reference this e2e path (or a `src/bun/testing/` twin); planner decides, but the env gate (index.ts lines 187–189 pattern) is mandatory.

---

### `e2e/api/copilotkit/copilotkit.test.ts` (HOST-01/02/03, D-06 — NEW)

**Analog:** `e2e/api/smoke.test.ts` (exact structure) + `e2e/api/mcp-oauth.test.ts` (raw fetch against `baseUrl` — needed because `/api/copilotkit/*` is NOT in `RailynAPI`, so `server.request()` can't reach it).

**Test skeleton** (smoke.test.ts lines 8–9, 45–53):
```typescript
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { startServer, type TestServer } from "./fixtures/server";

let server: TestServer;
beforeAll(async () => { server = await startServer({ copilotkitProbe: true }); }, 20_000);
afterAll(async () => { if (server) await server.shutdown(); });
```

**`waitFor` polling helper** (smoke.test.ts lines 13–29; also mcp-oauth.test.ts lines 59–70 — copy either; smoke's is the canonical one).

**Raw fetch pattern for non-RPC endpoints** (mcp-oauth.test.ts lines 196–205):
```typescript
const res = await fetch(`${server!.baseUrl}/api/mcp/oauth/callback?code=any-code`);
// copilotkit probe adaptation (research §Code Examples §Raw SSE probe):
const res = await fetch(`${server.baseUrl}/api/copilotkit/agent/default/run`, {
  method: "POST",
  headers: { "content-type": "application/json", accept: "text/event-stream" },
  body: JSON.stringify({ threadId: "t1", runId: "r1", tools: [], context: [], forwardedProps: {}, state: [], messages: [] }),
});
expect(res.status).toBe(200);
expect(res.headers.get("content-type")).toBe("text/event-stream");
const frames = (await res.text()).split("\n\n").filter(Boolean);
expect(JSON.parse(frames[0].slice("data: ".length))).toMatchObject({ type: "RUN_STARTED" });
```

**Assertion patterns to include:** `/info` 200 JSON (HOST-01), run 200 SSE with RUN_STARTED first (HOST-01), malformed body → 400 `{error: "Invalid request body"}` (HOST-01), >30s silence survival (HOST-02 — extend `server` test timeout; vitest per-file timeout via `bun test e2e/api/copilotkit --timeout 30000` or a longer per-test timeout), connect-before-run → 200 SSE with **zero** events (D-06, Pitfall 6 — ReplaySubject completes empty), stop route `POST .../agent/default/stop/:threadId` → `{stopped: true}` then idempotent `{stopped: false}` (Pitfall 4 — threadId in PATH).

**Negative control for HOST-02** (optional): temporarily omit `srv.timeout(req, 0)` and assert the stream dies at ~30s — skip if too slow.

---

### `e2e/api/copilotkit/sse-text-diff.test.ts` (D-07 fixture validation — NEW)

**Analog:** `e2e/api/smoke.test.ts` skeleton (server lifecycle) — but the core "capture both sides, diff SSE text" assertion has no codebase analog; use research Pattern 3 + the wire format from research §Code Examples §SSE framing.

**Core validation pattern** (research §Pattern 3 — the whole point of the test):
1. **Real side:** run scenario against real server via `startServer({ copilotkitProbe: true })` + raw fetch (mcp-oauth.test.ts fetch pattern); capture `await res.text()` → `data:` lines.
2. **Fixture side:** emit the same scenario's frames through `mock-agui`'s constructed body (or `EventEncoder` from `@ag-ui/encoder` — research's one-source-of-truth recommendation).
3. **Assert:** `data:` lines byte-identical (`expect(fixtureLines).toEqual(realLines)`).

**Wire format to assert on** (research §Code Examples §SSE framing — verbatim from `@ag-ui/encoder@0.0.57`):
```typescript
import { EventEncoder } from "@ag-ui/encoder";
const enc = new EventEncoder();
const frame = enc.encode({ type: "RUN_STARTED", threadId: "t1", runId: "r1", input: {} });
// frame === 'data: {"type":"RUN_STARTED","threadId":"t1","runId":"r1","input":{}}\n\n'
```
Framing facts to encode in assertions: `data: {json}\n\n` only — no `event:`/`id:` fields; `Content-Type: text/event-stream`; `Cache-Control: no-cache`; `Connection: keep-alive` (research line 13).

---

### `e2e/api/copilotkit/capture-real.ts` (capture script — NEW)

**Analog:** `scripts/postinstall.ts` (standalone bun script: top-level await, `Bun.spawn`, console logging) + `startServer()` fixture for the server.

**Script shape** (scripts/postinstall.ts lines 1–12 — top-level statements, no test framework):
```typescript
// top-level await script; run with `bun e2e/api/copilotkit/capture-real.ts`
import { startServer } from "./fixtures/server";
const server = await startServer({ copilotkitProbe: true });
try {
  // raw-fetch run (copilotkit.test.ts pattern), write frames to a file:
  await Bun.write("e2e/api/copilotkit/captured-run.sse", await res.text());
  console.log("captured", frames.length, "frames");
} finally {
  await server.shutdown();
}
```
Output path under `e2e/api/copilotkit/` (or a `.runtime/` scratch dir — server.ts's `runtimePath` at lines 37–45 is the existing scratch-dir convention). Check in the captured text or regenerate per run — planner's discretion; the diff test should not depend on a committed capture (stale-capture drift), prefer regenerating in-test.

---

### `e2e/api/copilotkit/pins.test.ts` (HOST-03 pin assertions — NEW)

**Analog:** partial — no existing pin-assertion test. Use `smoke.test.ts`'s describe/test shape with **no server** (pure unit), and `mcp-oauth.test.ts`'s node:fs reads (lines 46–54) for reading package.json.

**Pattern:**
```typescript
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));
test("pins are exact", () => {
  expect(pkg.dependencies["@copilotkit/runtime"]).toBe("1.66.4");
  expect(pkg.dependencies["@ag-ui/client"]).toBe("0.0.57");
  expect(pkg.dependencies["@ag-ui/core"]).toBe("0.0.57");
  expect(pkg.dependencies["@ag-ui/encoder"]).toBe("0.0.57");
  expect(pkg.dependencies["@copilotkit/vue"]).toBe("1.66.4");   // regular dep, NOT devDep (D-10)
});
```
Assert exact strings (no `^`) — matches D-09 and the existing exact-pin convention in package.json line 28.

---

### `e2e/ui/fixtures/mock-agui.ts` (SSE mock — NEW)

**Analog:** `e2e/ui/fixtures/mock-ws.ts` (`WsMock` — role-match: streaming mock with queue + push + install) and `e2e/ui/fixtures/mock-api.ts` (page.route dispatch conventions).

**WsMock's queue/push/install shape to copy** (mock-ws.ts lines 20–56):
```typescript
export class WsMock {
    private _page: Page;
    private _server: ... | null = null;
    private _messageQueue: string[] = [];
    constructor(page: Page) { this._page = page; }
    async install(): Promise<void> { ... }        // lines 30–46
    push(msg: PushMessage): void {                 // lines 48–56 — queue if not open
        const text = JSON.stringify(msg);
        if (this._server) this._server.send(text); else this._messageQueue.push(text);
    }
}
```

**Key difference — SSE over HTTP, not WS:** mock-agui intercepts `/api/copilotkit/**` via `page.route()` and `route.fulfill({ status: 200, contentType: "text/event-stream", body: frames.join("") })` — body must be pre-framed SSE text (`data: {json}\n\n` per `@ag-ui/encoder`; research §Don't Hand-Roll: use `EventEncoder` so the fixture can never drift).

**CRITICAL route-ordering finding:** `ApiMock.install()` registers `page.route("/api/**")` and returns **501 for every unhandled method** (mock-api.ts lines 83–92). `/api/copilotkit/*` matches that glob, so ApiMock would swallow the runtime paths and 501 them before mock-agui can respond. Two compatible resolutions (planner picks):
- **A (preferred):** edit `mock-api.ts`'s route handler to skip copilotkit paths — `if (url.pathname.startsWith("/api/copilotkit/")) { await route.fallback(); return; }` (Playwright `route.fallback()` hands to the next matching route — mock-agui's). No `route.fallback` usage exists yet in the codebase, so this is a new (small) pattern.
- **B:** document install order — Playwright tries the *most recently registered* route first; `mock-agui.install()` after `api.install()` wins. Fragile; needs a comment in both files.

**Fixture registration convention:** `e2e/ui/fixtures/index.ts` (lines 34–115) auto-installs `ws` and `api` via `base.extend`; mock-agui gets a parallel auto-fixture (e.g. `agui`) wired in the same file when Phase 6 consumes it — this phase only needs the class + validation, but keeping the `install()` shape identical from day one avoids rework.

---

### `e2e/ui/fixtures/mock-api.ts` (EDIT)

**Analog:** itself. Two coordinated edits (D-07 "extend in the established pattern"):
1. Route handler (lines 83–92): skip `/api/copilotkit/*` before the `_handlers.get(method)` lookup — see mock-agui section, resolution A. The existing 501-loud failure for everything else stays.
2. Document in the header comment (lines 1–14) that `/api/copilotkit/*` is owned by `mock-agui.ts`, not ApiMock.

---

### `package.json` (EDIT)

**Analog:** exact-pin convention, `"@anthropic-ai/claude-agent-sdk": "0.3.204"` (line 28) — no caret. Install via `bun add --exact @copilotkit/runtime@1.66.4 @ag-ui/client@0.0.57 @ag-ui/core@0.0.57 @ag-ui/encoder@0.0.57 @copilotkit/vue@1.66.4` (research §Standard Stack — never hand-edit; avoids bun.lock drift). All five in `dependencies` — `@copilotkit/vue` is a regular dep despite being unconsumed this phase (D-10; Phase 5 consumes it in the app). `@ag-ui/encoder` is a direct dep (fixtures + probe import it for framing — research §Standard Stack table).

---

### `.planning/PROJECT.md` (EDIT — evidence record)

**Analog:** itself. Three targeted edits:
1. **Key Decisions table** (lines 67–82): flip the `CopilotRuntime mounted in Bun.serve via hono handler` row (line 80) from `— Pending` to the fetch-native outcome with evidence pointer; add rows for D-01 (fetch-native, zero deps, reversible), D-04 (idleTimeout config: `srv.timeout(req, 0)` + `idleTimeout: 30` global), D-09 (exact pins), D-08 finding (self-hosted `/info` advertises local thread endpoints; `GET /threads` works, mutations 422 — supersedes the "Intelligence-only" claim at line 55).
2. **Context bullets** (lines 48–57): correct the hono assumption (line 54: "`@copilotkit/runtime` v2 exports hono/express/node handlers; hono chosen for Bun.serve integration") and the E2E line (57) to reflect the validated `mock-agui` foundation.
3. **Footer** (line 102): bump `Last updated` + add a dated evidence section capturing the actual `/info` JSON and `GET /threads` response (research §State of the Art — the Phase 4 contract evidence; success criterion 4).

## Shared Patterns

### Real-server spawn + typed request (`startServer()`)
**Source:** `e2e/api/fixtures/server.ts` lines 127–262
**Apply to:** copilotkit.test.ts, sse-text-diff.test.ts, capture-real.ts (via `startServer({ copilotkitProbe: true })`); use `baseUrl` + raw fetch for `/api/copilotkit/*` (it's AG-UI, NOT in `RailynAPI` — document that boundary per CONTEXT.md line 76).

### `waitFor` polling helper
**Source:** `e2e/api/smoke.test.ts` lines 13–29
**Apply to:** copilotkit.test.ts (silence-survival assertions that need to observe post-silence events).

### Env-gated test-only injection
**Source:** `src/bun/index.ts` lines 187–189 (`RAILYN_TEST_EXECUTION_ENGINE === "mock"`) + `src/bun/ai/retry.ts` lines 39–43 (env-knob read pattern)
**Apply to:** the `RAILYN_COPILOTKIT_PROBE` gate in `index.ts` + `server.ts` `extraEnv` wiring. Pattern: parse env once at module/startup, `Number.isFinite(v) && v > 0` style guard where numeric.

### Exact version pins
**Source:** `package.json` line 28 (`"0.3.204"` — no caret)
**Apply to:** the five new deps; `pins.test.ts` asserts exact strings.

### Mock streaming fixture (queue + push + install)
**Source:** `e2e/ui/fixtures/mock-ws.ts` lines 20–56; dispatch conventions from `mock-api.ts` lines 79–117 (loud 501 = fail-fast on unhandled; `handle()` overrides after install)
**Apply to:** `mock-agui.ts` (SSE variant: `route.fulfill` with pre-framed `data:` body instead of `ws.send`).

### Raw fetch for non-RPC endpoints
**Source:** `e2e/api/mcp-oauth.test.ts` lines 196–239 (`fetch(\`${server!.baseUrl}/...\`)`, status/header asserts)
**Apply to:** all copilotkit probes (run/connect/stop/info/threads).

## No Analog Found

Files with no close match in the codebase (planner should use RESEARCH.md §Code Examples / §Patterns instead):

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `e2e/api/copilotkit/sse-text-diff.test.ts` | test | streaming/transform | No existing fixture-validation test; the capture→diff mechanism is new (research Pattern 3) |
| `e2e/api/copilotkit/capture-real.ts` | script | transform | No existing SSE-capture script; closest is `scripts/postinstall.ts` (script shape only) |
| `e2e/api/copilotkit/pins.test.ts` | test | static | No existing package.json-assertion test |
| `e2e/ui/fixtures/mock-agui.ts` (class body) | fixture | streaming | No existing SSE-over-HTTP mock; `WsMock` covers queueing semantics but the `route.fulfill` SSE body + `EventEncoder` framing is new (research §SSE framing / §Don't Hand-Roll) |

## Metadata

**Analog search scope:** `src/bun/` (index.ts, testing/, ai/, server/), `e2e/api/` (tests + fixtures), `e2e/ui/fixtures/`, `scripts/`, `package.json`, `.planning/PROJECT.md`
**Files scanned:** 14
**Pattern extraction date:** 2026-08-08

**Key integration findings for the planner:**
1. **Mount order is load-bearing:** copilotkit prefix dispatch MUST precede the `POST /api/` RPC router in `src/bun/index.ts` (line 306) or RPC 404s swallow the runtime (research Pitfall 3).
2. **`srv.timeout(req, 0)`** goes in the copilotkit branch only — keep global `idleTimeout: 30` (research Pitfall 1).
3. **Playwright route conflict:** `ApiMock`'s `page.route("/api/**")` + 501-default (mock-api.ts lines 83–92) will swallow `/api/copilotkit/*`; resolve via `route.fallback()` skip in mock-api.ts (preferred) or strict install ordering.
4. **`startServer()` needs one seam:** an optional flag mapping to `RAILYN_COPILOTKIT_PROBE=1` env, following the existing `mcpConfig` → `extraEnv.RAILYN_DATA_DIR` pattern (server.ts lines 133–140).
5. **No copilotkit/ag-ui code exists yet** anywhere outside `.planning/` — all production imports are new; zod v4 vs runtime's zod@3 must not mix (research Pitfall 5).
