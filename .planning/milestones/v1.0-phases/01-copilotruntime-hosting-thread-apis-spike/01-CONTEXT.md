# Phase 1: CopilotRuntime Hosting & Thread APIs (Spike) - Context

**Gathered:** 2026-08-08
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase delivers the **runtime hosting spike**: prove that a self-hosted CopilotRuntime runs inside the existing single Bun.serve process on a pinned AG-UI/CopilotKit stack, that run/connect/stop round-trips work over SSE, that long SSE streams survive extended engine silences, and that the mock runtime fixtures intended as the E2E foundation are validated against the real server. It does NOT build the engine bridge (Phase 2), interrupts (Phase 3), persistence or thread-index endpoint (Phase 4), or any UI (Phase 5).

</domain>

<decisions>
## Implementation Decisions

### Runtime Handler & Mounting
- **D-01:** Use the fetch-native `createCopilotRuntimeHandler` from `@copilotkit/runtime/v2` mounted directly into the existing `Bun.serve` fetch handler — NOT hono. Research evidence (STACK.md §Stack Patterns) contradicts PROJECT.md's earlier hono assumption: the fetch handler is Bun/Deno/Workers-native, adds zero framework dependencies, and the app is single-process same-origin. — **Reversibility:** reversible — swapping to `createCopilotHonoHandler` later is a one-line change in the composition root.
- **D-02:** Mount the runtime under the `/api/copilotkit/*` path prefix in multi-route default mode (run/connect/stop/info routes), keeping the existing `/api/*` RPC namespace coherent. — **Reversibility:** reversible — the prefix is a mount-time constant.
- **D-03:** Same-origin serving — the Vue SPA and the runtime share one origin. No CORS setup or extra server process. Reconfirm during the spike that no CORS options are needed.
- **D-04:** Bun.serve `idleTimeout` (default 30s) is a known SSE killer during long agent silences — the spike MUST verify stream survival and record the working configuration (explicit high/zero idle timeout and/or SSE-appropriate handling) in PROJECT.md as evidence for HOST-02.

### Spike Probe Scope
- **D-05:** The run/connect/stop round trip is proven with a scripted/test agent (the existing mock engine `src/bun/testing/mock-engine.ts` pattern) — deterministic, no API keys, no network. Real-engine bridging is Phase 2.
- **D-06:** The spike verifies the "connect to a thread that never ran returns a valid empty conversation snapshot" contract on the real runtime (precursor to RUNR-06 in Phase 2).
- **D-07:** Mock runtime fixtures (`mock-runtime`/`mock-agui`) are validated against the real server in this phase (success criterion 5) and become the E2E foundation consumed by Phase 6. Extend `e2e/ui/fixtures/mock-api.ts` in the established pattern.
- **D-08:** `useThreads` is NOT usable against a self-hosted runtime (Intelligence-only per research). The own thread-index endpoint is Phase 4 (CHAT-08) — out of scope here. The spike only verifies what the runtime's own thread routes do so the Phase 4 contract can be written against evidence.

### Stack Pinning
- **D-09:** Pin exact versions: `@ag-ui/core@0.0.57`, `@ag-ui/client@0.0.57`, `@copilotkit/runtime@1.66.4`, `@copilotkit/vue@1.66.4` (runtime+vue must stay on the same release line; do NOT bump AG-UI independently — types drift). — **Reversibility:** reversible — version bump.
- **D-10:** CopilotKit Vue is early-access — the spike does not consume the Vue SDK; it establishes the package.json pins and any install-time findings so Phase 5 can wrap usage in thin local components.

### the agent's Discretion
- Exact fixture implementation shape (mock SSE framing, event sequence helpers) — researcher/planner picks within the existing `mock-api.ts`/`mock-ws.ts` conventions.
- Whether to keep spike probe code as a script or fold it into `e2e/api/fixtures/` — planner decides; must not pollute production `src/bun/`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research (produced this project)
- `.planning/research/STACK.md` — Pinned versions, fetch-native-vs-hono evidence (§Stack Patterns), useThreads Intelligence-only finding, dependency-compat matrix. **Primary evidence source for HOST-03.**
- `.planning/research/ARCHITECTURE.md` — 3-layer shape, custom-runner extension pattern, connect-before-run contract, replay semantics.
- `.planning/research/PITFALLS.md` — SSE idleTimeout killer, run-locking SSE error surface, replayed tool-call result synthesis.
- `.planning/research/FEATURES.md` — Thread listing scope, anti-features (realtime sync, frontend tools), MVP definition.
- `.planning/research/SUMMARY.md` — Synthesized roadmap implications; Phase 1 = "CopilotRuntime Hosting & Thread APIs (Spike)".

### Project documents
- `.planning/PROJECT.md` — Project context; note: "hono handler" assumption there is superseded by D-01; spike records corrected evidence.
- `.planning/REQUIREMENTS.md` — HOST-01, HOST-02, HOST-03 (this phase); RUNR-06/CHAT-08 referenced as downstream contracts.
- `.planning/ROADMAP.md` §Phase 1 — 5 success criteria this phase must meet.

### Codebase (integration points)
- `src/bun/index.ts` — Composition root; the fetch handler where the CopilotRuntime handler mounts; existing `/api/*` + `/ws` wiring; graceful shutdown.
- `src/bun/testing/mock-engine.ts` — Scripted `ExecutionEngine` pattern for the spike probe agent.
- `e2e/api/fixtures/server.ts` — Real-server spawn fixture (`RAILYN_FORCE_MEMORY_DB=1`, port from stdout) — the pattern for proving run/connect/stop against a real runtime.
- `e2e/ui/fixtures/mock-api.ts` + `mock-ws.ts` — Fixture foundation to extend/validate (typed against `RailynAPI`; 501 for unhandled methods).
- `playwright.config.ts` — UI specs run against `dist/` via `vite preview`; backend fully mocked.
- `config/engines.yaml`, `config/workspace.yaml.sample` — Engine/provider config context (no new config expected in this phase).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/bun/testing/mock-engine.ts`: scripted engine producing deterministic `EngineEvent` streams — use as the spike probe agent's execution source.
- `e2e/api/fixtures/server.ts`: proven real-server spawn (in-memory DB, temp config, stdout port) — reuse for the runtime probe; extend with SSE assertions if not already present.
- `e2e/ui/fixtures/mock-api.ts` (`ApiMock`, `handle<T extends keyof RailynAPI>`): typed mock foundation — the pattern the new CopilotKit/AG-UI mocks must follow (loud 501 on unhandled routes).
- `RAILYN_STREAM_IDLE_TIMEOUT_MS` env (`src/bun/ai/retry.ts:41`): existing stream idle timeout knob — check whether it interacts with SSE idle handling before adding a new one.

### Established Patterns
- Composition-root wiring in `src/bun/index.ts` with constructor injection and late-binding for circular deps (e.g., `StreamEventProcessor.setMarkClaudeExecution`).
- RPC contract discipline: `src/shared/rpc-types.ts` is the single source of truth; new endpoints must be typed there (the runtime mount is an exception — it speaks AG-UI, not RPC; document that boundary).
- E2E discipline: UI specs never hit a real Bun server; API tests always do. The runtime probe belongs on the API-test side.
- Write buffering + broadcast via `BroadcastChannel` — the runtime mount should NOT route through the legacy stream pipeline in this phase (no bridge yet).

### Integration Points
- `src/bun/index.ts` fetch handler — where `createCopilotRuntimeHandler` mounts (`/api/copilotkit/*`), alongside `POST /api/*` routing and `/ws` upgrades.
- `src/bun/server/` — new server-side module for runtime hosting if the planner prefers isolation from `index.ts`.
- `e2e/api/` — home for the runtime probe test (real server); `e2e/ui/fixtures/` — home for the validated mock fixtures.

</code_context>

<specifics>
## Specific Ideas

- Success criterion 4: "Exact versions pinned; fetch-native vs hono decision recorded with evidence in PROJECT.md" — the spike output must UPDATE PROJECT.md with the decision (superseding the hono assumption).
- Success criterion 5: mock fixtures validated against the real server "and usable as the E2E foundation" — validation = comparing fixture-emitted SSE/AG-UI sequences to real runtime responses for the same scenario.
- Keep the spike throwaway-friendly: probe code in `e2e/` or a scratch script, not production `src/bun/`.

</specifics>

<deferred>
## Deferred Ideas

- Own thread-index endpoint (`GET /api/threads`) — Phase 4 (CHAT-08), contract written from Phase 1 evidence of runtime thread-route behavior.
- Regenerate/retry API verification — Phase 5 concern; JSONL replay fallback if unconfirmed.
- hono handler — only if the app later grows real HTTP middleware needs (auth, CORS for a remote client).
- None — discussion stayed within phase scope.

</deferred>

---

*Phase: 1-CopilotRuntime Hosting & Thread APIs (Spike)*
*Context gathered: 2026-08-08*
