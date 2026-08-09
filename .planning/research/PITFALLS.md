# Pitfalls Research

**Domain:** AG-UI + CopilotKit adoption — replacing a custom chat stack (StreamEvent protocol, dual-layer conversation store, custom UI, SQLite chat storage) with AG-UI wire protocol, CopilotKit Vue UI, custom JSONL-backed AgentRunner, and self-hosted CopilotRuntime in Bun.serve
**Researched:** 2026-08-08
**Confidence:** MEDIUM (protocol contract details verified against official AG-UI docs + CopilotKit docs/issues; Vue SDK details from PR review + package README; localhost hosting specifics from codebase analysis + Bun knowledge)

## Critical Pitfalls

### Pitfall 1: Runner `connect()` errors on threads that have never run ("connect-before-run")

**What goes wrong:**
The frontend mints a `threadId` (for Railyin: `String(conversation.id)` or a new UUID) and calls `connect()` *before* the first `run()` has ever produced events — first page load, opening an empty board-card conversation. A persistence-backed runner that only "knows" a thread once a run starts 404s or throws on that first connect, so the UI shows an error/blank state instead of an empty conversation. This is documented by CopilotKit as a top adoption failure: "A persistence backend that only learns about a thread once a run starts can 404 (or error) on that first connect."

**Why it happens:**
`connect()` is the rehydration path, but it is also fired on brand-new threads. The `InMemoryAgentRunner` hides the problem because it stores threads lazily in a `globalThis` Map and returns an empty stream for unknown ids; a custom runner (Railyin's JSONL runner) that treats "no file yet" as an error breaks the happy path.

**How to avoid:**
Treat "thread file does not exist" as a valid state. Return the canonical empty sequence used by CopilotKit's own `AgentCoreRunner` (official reference pattern):
`RUN_STARTED(threadId, runId)` → `MESSAGES_SNAPSHOT(messages: [])` → `RUN_FINISHED(threadId, runId)`.
Write a unit test for `connect()` on (a) missing file, (b) existing file with 0 runs, (c) file with N completed runs, (d) file with an interrupted run.

**Warning signs:**
- First load of a new conversation shows an error toast or "agent_connect_failed" (`AGENT_CONNECT_FAILED` error code) but works after the first message
- `connect()` handler throws "no such file" / ENOENT in server logs
- Thread list shows conversations the user never sent a message in as errored

**Phase to address:**
Phase: **AG-UI Bridge & RailyinAgentRunner** (runner `connect()` contract). Re-verify in **E2E Migration** with a spec that loads a fresh conversation and asserts an empty chat renders.

---

### Pitfall 2: Replaying thread history in a shape the AG-UI client rejects (missed-event / multi-run replay)

**What goes wrong:**
`connect()` replays the whole JSONL event log so late clients can catch up on active runs and reloads can rehydrate. Two failure modes:
1. **verifyEvents lifecycle rejection** — the AG-UI client validates that a stream follows run lifecycle (`RUN_STARTED` before content, `RUN_FINISHED`/`RUN_ERROR` to complete). Replays containing events from *multiple past runs*, or a run that ended in `RUN_ERROR` followed by another `RUN_STARTED`, throw `Cannot send event type 'RUN_STARTED': The run has already errored with 'RUN_ERROR'` → thread fails to hydrate on reload (GitHub issue #4943; CopilotKit's IntelligenceAgent had to override `connectAgent` to skip `verifyEvents`).
2. **Missed live events** — if `connect()` only replays *completed* runs and the runner holds active-run events only in memory, a second tab / reload mid-run loses everything after the last persisted point.

**Why it happens:**
Replay is treated as "the same thing as a live run" instead of "history, then optionally live tail". The JSONL log is a sequence of runs, and emitting them back verbatim does not satisfy the single-run lifecycle the client expects. Persisting events lazily (only on run end) is tempting for performance but breaks catch-up.

**How to avoid:**
- Persist events to JSONL as they stream (append per event), not in a single run-end write. Then `connect()` replays the full log — this is exactly what `InMemoryAgentRunner` and `SqliteAgentRunner` do (append-only event log per run).
- Structure the replay as per-run blocks and verify (test!) that a log containing an errored run followed by a successful run rehydrates cleanly on the current pinned `@ag-ui/client` version. If it trips verifyEvents, normalize the replay: emit each run's events in order but sanitize the boundary (or check whether the pinned client version already handles multi-run replays — #4943's core-side fix landed in `@copilotkit/core` 1.57.3; verify against the pinned version, do not assume).
- For active runs: replay persisted history, then subscribe the stream through the runner's live subject so subsequent events flow. Test "connect during active run" explicitly (this is the `connect()` must replay historic events so late clients can catch up on an active run contract).

**Warning signs:**
- Reload mid-conversation shows only part of the history or errors with `agent_connect_failed`
- Console error mentioning `RUN_ERROR` + `RUN_STARTED` / "verifyEvents"
- History appears up to the last *completed* run but the newest run is missing entirely

**Phase to address:**
Phase: **AG-UI Bridge & RailyinAgentRunner** (replay contract + tests). Add a dedicated unit test file for replay shapes (multi-run, errored-run, active-run tail) before the frontend consumes it.

---

### Pitfall 3: `MESSAGES_SNAPSHOT` synthesis — treating it as a cheap "here's the history" shortcut

**What goes wrong:**
`MESSAGES_SNAPSHOT` uses **edit-based merge**: messages in the snapshot replace existing ones, messages *not* in the snapshot are **removed** from client state, new ones are appended. Emitting a partial snapshot mid-stream (e.g., from a stale cache or a read racing an in-flight run) deletes messages the user can see, and synthesizing a snapshot from non-authoritative sources (e.g., half-imported SQLite rows) permanently drops content from the client view. Conversely, replaying a snapshot of assistant messages with tool calls but no `TOOL_CALL_RESULT` events leaves the UI with tool calls stuck in "running" (see Pitfall 7).

**Why it happens:**
Developers assume snapshot == "send me the current state" and reach for it because it's simpler than replaying events; the edit-based semantics are surprising and undocumented in most quickstarts.

**How to avoid:**
- Follow the runners' actual pattern: `connect()` replays the **event log**, not a synthesized snapshot. Only use `MESSAGES_SNAPSHOT` for: (a) empty threads (`messages: []`), and (b) **legacy import**, where SQLite `conversation_messages` rows are converted once — and only after reconciling tool calls (synthesize empty `TOOL_CALL_RESULT` per replayed tool call, the AgentCoreRunner pattern) so the UI doesn't show phantom running tools.
- Never read the JSONL file for a snapshot while a run is appending to it — snapshot the file/events at run start or use the runner's in-memory mirror.

**Warning signs:**
- History vanishes from the UI after a refresh but reappears in the file
- A tool call renders as "Running…" forever in old conversations (see Pitfall 7)
- Imported legacy threads show fewer messages than `conversation_messages` contains

**Phase to address:**
Phase: **JSONL Persistence & Legacy Import** (import reconciliation). Guarded by unit tests asserting snapshot merge semantics against a fake message store.

---

### Pitfall 4: Run locking / concurrency — two executions racing on one thread

**What goes wrong:**
Railyin's board triggers transitions that execute agents, and chat turns run on the same conversation (`conversationId` is the universal routing key today). With threads mapped to conversations, two concurrent runs on one thread interleave events in the JSONL file and corrupt the client's message state. CopilotKit's contract: `run()` **must throw `Error("Thread already running")`** when a run is active for that threadId — both `InMemoryAgentRunner` and `SqliteAgentRunner` do exactly that (`run_state` gate table in SQLite). The additional trap: **in SSE mode (self-hosted runtime — Railyin's case) the lock surfaces as a generic HTTP 500** with the message text `"Thread already running"` — the typed `409 agent_thread_locked` code only exists in Intelligence mode. Clients cannot branch on the typed code; they must guard with a busy flag on submit.

**Why it happens:**
The old stack had its own cancellation semantics (orchestrator `cancel`, zombie cleanup races — a known fragile area per CONCERNS.md). Porting "fire a run" call sites into `run()` without a lock check recreates the interleaving the old stack fought.

**How to avoid:**
- Implement the lock in `RailyinAgentRunner.run()`: a per-thread in-process map + JSONL-gate (mirror `run_state`), throwing `"Thread already running"` on contention. Do not rely on the runtime to serialize.
- Decide the policy for board-driven executions vs chat turns: a transition run and a chat run on the same thread must not overlap — either reject with a busy state (and surface "agent busy" in UI) or queue. The old stack's `executions` rows + status transitions should be mapped to `isRunning()`.
- Client side: disable submit while `isRunning` (or use the busy flag pattern) — do not depend on a typed lock error code in SSE mode.
- Handle `stop()` → abort the engine's AbortController (the existing `StreamProcessor`/AbortController plumbing), and make `isRunning()` accurate (runtime polls it).

**Warning signs:**
- Two messages submitted quickly → 500s with "Thread already running" in logs
- JSONL file contains interleaved event runs (validate: each run's events should be contiguous)
- UI shows a double-send that the old stack prevented
- Status flips (running/cancelled/failed) race — the known orchestrator race (CONCERNS.md) reappearing through the runner

**Phase to address:**
Phase: **AG-UI Bridge & RailyinAgentRunner** (lock + stop/isRunning contract). Stress-tested in **E2E Migration** (concurrent submit spec) and backend tests driving two engines on one thread.

---

### Pitfall 5: Interrupt contract mismatch — `on_interrupt` naming, resume channel, stranded runs

**What goes wrong:**
AG-UI has **two interrupt channels**, and mixing them strands runs:
- **Canonical (current):** interrupted run ends with `RUN_FINISHED` carrying `outcome: { type: "interrupt", interrupts: [{ id, reason, message, toolCallId, responseSchema, expiresAt, metadata }] }`. Resume via `RunAgentInput.resume[] = [{ interruptId, status: "resolved" | "cancelled", payload }]`.
- **Legacy:** a `CUSTOM` event named `on_interrupt` (LangGraph emits it by default; `agent.interrupt` signal). Resume via `forwardedProps.command.resume` — **deprecated**.

The documented failure (AG-UI langgraph integration, explicitly): clients that resume through the legacy `forwardedProps.command.resume` channel **stop sending a resume directive once they observe the structured outcome** → the run is silently stranded. This is why `emitInterruptOutcome` defaults off in the LangGraph integration. Contract rules that bite: resume must use the **same threadId**; `interruptId` must match an existing interrupt; **one resume array must address ALL open interrupts** (partial resumes unsupported); **pending interrupts block new input on the thread**; expired interrupts (past `expiresAt`) are not resumed.

**Why it happens:**
Railyin's `decision_request` must map to interrupts. Porting the old `decision_requests`/`task_hunk_decisions` resume call sites naively (or half-adopting the legacy event name) produces a UI that shows a decision, a user clicks "approved", and the engine never resumes — because the bridge read the wrong channel or didn't translate `resume[]` back into the engine's decision-resume API.

**How to avoid:**
- Go **all-canonical**: the bridge emits `RUN_FINISHED` with `outcome.type === "interrupt"` (interrupt id stable per decision batch, `reason: "decision_request"`, payload carrying the decision context), and consumes `RunAgentInput.resume[]` → translate entries to `orchestrator`'s existing decision-response calls. Do **not** emit legacy `on_interrupt` events, and do **not** read `forwardedProps.command.resume`.
- Use CopilotKit Vue's `useInterrupt` (v2 composable, handles both channels): `resolve(payload)` / `cancel()`; it accumulates one response per open interrupt and starts the resume run only when all are addressed — matches the contract's "no partial resumes" rule.
- Enforce the "pending interrupt blocks new input" rule server-side: the runner/bridge must reject a `run()` without `resume[]` while a decision interrupt is pending for that thread.
- Map engine-level resume semantics: Railyin's `decision_request` resume carries `{ decision: 'approved'|'rejected', ... }` — map to `resume: [{ interruptId, status: "resolved", payload: { decision, ... } }]`.
- Railyin's old flow "run pauses instead of ending" maps to "run finishes with interrupt outcome" — the UI must not render it as an error (RUN_FINISHED with interrupt outcome is a normal completion with `isLoading=false`).

**Warning signs:**
- Decision appears in UI, user answers, nothing happens (stranded run) — check server logs for resume arriving on the wrong channel
- Duplicate or mismatched `interruptId` (client sends resume for an id the runner never issued)
- Second message send while a decision is pending silently starts a parallel run instead of being blocked
- Tests that "resume after decision" hang on the first run

**Phase to address:**
Phase: **Decision Interrupts & Resume** — dedicated phase; contract tests with a fake engine that pauses, then resumes via `resume[]`, asserting the engine receives the translated decision.

---

### Pitfall 6: CopilotKit Vue early-access gaps — assuming React parity, wrong import paths, silent failures

**What goes wrong:**
`@copilotkit/vue` is a recent port (PRs #4357/#4400, "~994 tests", released into npm; still evolving — parity fixes landed after release). Adopting it while assuming React behavior causes: missing hooks breaking builds; silent failures (e.g., `useInterrupt` handler errors swallowed, `resolveInterrupt` fire-and-forget — documented in the #4400 review); `useFrontendTool` render-registration leaks; missing provider props (`renderToolCalls`, `licenseToken`, `inspectorDefaultAnchor`); `useSingleEndpoint` "auto" mode missing; and a **different markdown renderer** (`streamdown-vue` vs React's) → visible rendering differences (and lost Mermaid, already accepted). Import path confusion: v1-compat root export vs `@copilotkit/vue/v2` — mixing v1 and v2 components in one tree breaks context. Vue uses named slots where React uses render props — porting React examples verbatim into Vue templates is the classic failure.

**Why it happens:**
Docs/quickstarts are React-first; Vue docs are thinner and live in the package README/PARITY.md; the SDK is versioned and changes between minor releases (testids renamed `copilot-chat-cursor` → `copilot-loading-cursor`; `tool-call` slot statuses `inProgress|executing|complete`).

**How to avoid:**
- Pin exact versions of `@copilotkit/vue`, `@copilotkit/runtime`, `@ag-ui/core` (PROJECT.md already mandates) and wrap all usage in thin local components (also mandated) so SDK churn is absorbed in one place.
- Import everything from `@copilotkit/vue/v2` (the clean v2 API) and never mix v1/v2 exports.
- Treat React docs as *directional*: verify every hook/component against the Vue README + Vue Storybook. Budget for a parity-surprise buffer in the UI phase.
- Plan for the known silent-failure surfaces: wrap `useInterrupt` handler calls in try/catch; verify submit disable during running (the "agent is null → message silently dropped" path); test `useFrontendTool` registration/deregistration (leak).
- Check `PARITY.md` in the installed package for the living parity matrix before each upgrade.

**Warning signs:**
- Template warnings about unresolvable slots/components that React docs show as props
- Interrupt handler that never fires errors (silently swallowed)
- A component works in a React example but renders nothing in Vue with no error
- Build succeeds but runtime context errors (provider not wrapping, v1/v2 mixed)

**Phase to address:**
Phase: **Chat UI Replacement (Vue)** — build the thin wrapper layer first, spike `CopilotChat` + slots before committing to full port; re-verify on every pinned-version bump.

---

### Pitfall 7: Tool-call slot rendering — replayed vs live events get out of sync

**What goes wrong:**
The Vue tool-call slot (`#tool-call-<name>` / `#tool-call` fallback) resolves status by looking up the tool *message* with the matching `toolCallId`: found → `complete` with result; not found → `inProgress`/`executing` forever. Three documented failure modes:
1. **Missing `TOOL_CALL_RESULT` in replayed history** → every tool call in old threads renders as running forever (CopilotKit's AgentCoreRunner synthesizes empty results precisely for this).
2. **Duplicate `toolCallId` on replay** — `connect()` replaying `TOOL_CALL_START` over pre-populated message state pushes the same toolCallId twice (`@ag-ui/client` `defaultApplyEvents` has no duplicate guard; issue #3928) → duplicate-key warnings and dropped UI.
3. **Interleaved tool calls duplicate the assistant message** — the client's `TOOL_CALL_START` attach logic only checks the *last* message id; after a `TOOL_CALL_RESULT` appends a `role: "tool"` message, a later `TOOL_CALL_START` for the same parent creates a second assistant message with the same id, and message-level dedup hides the earlier content (issue #3644). This is triggered by event ordering as emitted by the runner.

**Why it happens:**
The JSONL log faithfully records what the engine emitted, but the engine's ordering (tool start → tool result → more tool starts for the same assistant message) doesn't match what the client's message-assembly expects. Railyin's ported renderers for shell/file/delegate tools (PROJECT.md) amplify this — custom slots are the most sensitive to stuck/duplicated states.

**How to avoid:**
- Persist tool results in the right shape: every persisted `TOOL_CALL_START` must have a matching `TOOL_CALL_RESULT` (or be followed by events that complete it). On replay, if history has assistant messages with tool calls but no results (legacy import case), synthesize empty `TOOL_CALL_RESULT` entries before/around the snapshot (AgentCoreRunner pattern).
- Normalize event order in the bridge when needed: keep `TOOL_CALL_START` events for the same `parentMessageId` contiguous before emitting `TOOL_CALL_RESULT` where the protocol allows.
- Add a regression test: replay a thread with interleaved tool calls (the issue #3644 sequence) and assert exactly one assistant message renders with all tool calls, none stuck in-progress.
- Do not rely on the client's message-level dedup to fix duplicates — it hides content.

**Warning signs:**
- Replayed threads show "Running…" tool cards that never finish
- Browser console duplicate-key warnings (`Encountered two children with the same key`)
- "Deduplicated N message(s) with duplicate IDs" dev warnings after reload
- Ported shell/file/delegate renderers receive `status: inProgress` for historical events

**Phase to address:**
Phase: **Chat UI Replacement (Vue)** (slots) **+ JSONL Persistence & Legacy Import** (result synthesis). Verified via e2e specs asserting tool-card states on replayed threads.

---

### Pitfall 8: JSONL thread persistence — atomicity, corruption, index drift

**What goes wrong:**
Per-thread `data/threads/{threadId}.jsonl` is Railyin's source of truth for chat. Failure modes:
1. **Corruption:** a crash mid-append leaves a partial trailing line; the whole file becomes unreadable if parsing is strict → thread history lost.
2. **Index drift:** thread metadata (name, `updatedAt`, `lastRunAt`, archived) kept in a separate index (needed for the thread-list endpoint since `useThreads` has no self-hosted contract) desyncs from the event log → stale sidebar, wrong "last activity", threads missing from the list.
3. **Non-atomic multi-writer appends:** two runs appending to one file interleave/truncate lines (mitigated by the run lock in Pitfall 4, but the file layer must still be single-writer per thread).
4. **Missing event IDs:** replaying without stable per-event IDs forfeits the dedup/reconnect cursor (`lastSeenEventId` / `cpki_event_id` pattern) — duplicate events on reconnect cannot be filtered.

**Why it happens:**
File-based stores look trivial, so correctness details (crash tolerance, single-writer discipline, event identity) get skipped; the official SQLite runner exists partly because it bakes these in (`append-only agent_runs` rows, `run_state` gate, `schema_version`).

**How to avoid:**
- Append-only per-event lines, each a single `JSON.stringify` — tolerant reader that skips + logs a partial trailing line instead of failing the whole file. Test crash recovery by truncating a file mid-line.
- One append handle per thread; serialize writes (the runner's run lock gives this for runs; ensure import/live-run writes also serialize).
- Derive the thread index from the event log at boot (scan files) or write the index via atomic tmp-file + rename; treat the index as rebuildable cache, never as source of truth. `lastRunAt` should come from the last `RUN_STARTED` in the log.
- Assign each persisted event a stable id (`{ id: uuid }` or sequence) for dedup on replay/reconnect; document the format in one place (`data/threads/README.md` or a constant).
- Never hold the JSONL as the *only* copy of a message mid-run — the runner writes as it streams, so a crash loses at most the in-flight tail, which matches the old `stream_events` behavior.

**Warning signs:**
- `JSON.parse` errors at startup reading a thread (partial line)
- Thread list shows wrong last-activity order after a crash/restart
- Reconnect duplicates messages (no event ids)
- Two files for one conversation (threadId format drift — see Integration Gotchas)

**Phase to address:**
Phase: **JSONL Persistence & Legacy Import** — corruption/recovery unit tests (truncated file, empty file, interleaved runs) before wiring the thread-list endpoint.

---

### Pitfall 9: CopilotRuntime hosting in Bun.serve — routing order, SSE idle timeout, CORS, stream protocol

**What goes wrong:**
Mounting the hono handler inside Bun.serve (`createCopilotHonoHandler({ runtime, basePath: "/api/copilotkit", ... })` from `@copilotkit/runtime/v2`) breaks in four distinct ways:
1. **Path routing order:** if the existing `/api/*` RPC router matches first, CopilotKit requests (`POST /api/copilotkit/agents/default/run`, `GET /api/copilotkit/info`) fall into the RPC error handler → 500s; also `basePath` collisions with existing endpoints.
2. **SSE idle timeout:** Bun.serve's global `idleTimeout: 30` (Railyin's current setting) can kill long-lived SSE connections when the agent "thinks" for >30s without emitting an event — mid-run stream dies, client sees the run fail. This is the most likely silent killer of long engine runs (multi-hour runs exist in this codebase).
3. **CORS:** same-origin works in production (Bun serves `dist/`), but the Vite dev server (different port) is cross-origin → the runtime's `GET /info` bootstrap fails with `RUNTIME_INFO_FETCH_FAILED` unless CORS origin includes the dev origin (and `credentials: true` requires an explicit origin, never `"*"`).
4. **Stream protocol:** the runtime response is SSE (`text/event-stream`, `EventEncoder` negotiates content type via the client's `accept` header). Compression, buffering middleware, or `Content-Length` breaks chunking; the hono handler must be first in the chain and un-wrapped by any body-consuming middleware.

**Why it happens:**
A single-process server with one `fetch` handler (Railyin's `src/bun/index.ts`) makes it easy to bolt the handler on after routing logic; Bun.serve tuning (idleTimeout) predates the SSE need; dev-mode CORS is invisible until the first browser run.

**How to avoid:**
- Mount the CopilotKit handler **first** in the Bun.serve fetch dispatch (before `/api/*` RPC and before static serving); use `basePath: "/api/copilotkit"` and assert no overlap with existing methods.
- Raise `idleTimeout` for SSE (or test empirically whether Bun's idleTimeout applies to streaming responses; if it does, either raise the global value or add SSE heartbeat comment frames — `: keep-alive\n\n` every ~15s — from the runner during long silences). Long agent runs must not die at 30s.
- Configure CORS with explicit dev origins (`cors: { origin: ["http://localhost:5173", ...] }`) or proxy `/api/copilotkit` in the Vite config; keep prod same-origin.
- Use `createCopilotHonoHandler` (multi-route default) and confirm the `mode` choice early — single-route vs multi-route changes the URL surface that e2e mocks must match.
- Add an e2e API test that hits `/api/copilotkit/info` and a full run over the real Bun server early (before frontend work), pinning the wire shape.

**Warning signs:**
- All CopilotKit calls 500 while other `/api/*` works (routing order)
- Runs fail after ~30s of agent silence with no error in engine logs (idleTimeout)
- Dev console: CORS errors on `/api/copilotkit/info`
- Stream renders only after the run completes (buffering)

**Phase to address:**
Phase: **CopilotRuntime Hosting & Thread APIs** — verify `/info` + run + connect over the real Bun server before the frontend migration starts.

---

### Pitfall 10: History readback for engine context assembly — rebuilding context from JSONL incorrectly

**What goes wrong:**
The old stack assembled engine context from `conversation_messages` (via `src/bun/conversation/*` — context estimation, cross-engine context transfer, prompt/stage/decision injectors). After migration, the engine bridge must assemble context from the JSONL event log. Failure modes:
1. **Reading while appending:** reading the file mid-run returns a torn/partial view; the engine sees a truncated conversation or duplicate tail.
2. **Reconstructing messages naively:** assistant text must be reassembled from `TEXT_MESSAGE_START/CONTENT/END` deltas; tool calls from `TOOL_CALL_START/ARGS/END` + results; reasoning from reasoning events — skipping any family silently shrinks context.
3. **Interrupted/errored runs:** a run that died mid-turn leaves a partial assistant message; feeding it to the next engine as "complete" corrupts the model's understanding; the old stack had `RUN_ERROR` handling + compaction that must be replicated.
4. **Dedupe/ordering:** without run-scoped dedupe (runId + event id), reconnects or double-appends duplicate turns into context; `fetchRunHistory`/`convertMessagesToEvents` (CopilotKit PR #3173) exists precisely to dedupe imported history at message/run level.
5. **Cross-engine context transfer** (existing, fragile, barely tested per CONCERNS.md) now reads from a different source — regressions here are silent (degraded task handoffs).

**Why it happens:**
Context assembly was written against a message table; the new source is an event log with a different shape (deltas, runs, tool interleaving), and the read path is easy to bolt on without the reconstruction logic.

**How to avoid:**
- Build a single pure function: `eventsToMessages(jsonlEvents) → EngineMessage[]` with unit tests per event family (text deltas, tool calls with results, reasoning, interrupts, errored runs) and run-grouped dedupe (runId, messageId, event id). Reuse it for both context assembly and any snapshot synthesis.
- Snapshot the file (or use the runner's in-memory mirror) at run start; never read the live file during a run.
- Map interrupted runs to the same semantics the old `decision_request` pause had: the resumed run gets the *decision* translated, not the raw interrupt payload, and the partial assistant message is finalized with the interrupt outcome.
- Port the old context-estimation / compaction behavior against the new message list — verify token budget logic still applies.

**Warning signs:**
- Engine responses referencing messages that aren't in the thread (duplicated context) or missing recent turns (torn read)
- Compaction/context-estimation numbers differ wildly from pre-migration
- Cross-engine handoffs degrade (tasks handed to another engine lose context)

**Phase to address:**
Phase: **AG-UI Bridge & RailyinAgentRunner** (context assembly) with a dedicated unit suite; cross-engine transfer regression tests in the same phase (CONCERNS.md flags this path as already under-tested).

---

### Pitfall 11: Migrating the 55 Playwright e2e specs — mocking the wrong layer

**What goes wrong:**
The e2e suite mocks the old protocol (`/api/**` + `/ws` with `WsMock.pushStreamEvent`, `pushDone`). After migration the chat traffic goes to `POST /api/copilotkit/agents/{agentId}/run` (SSE) + `GET /api/copilotkit/info` + `connect`/`stop`, while board reactivity stays on `/ws`. Failure modes:
1. **Mocking the wrong boundary:** continuing to mock the old `conversation.*` RPC endpoints (which will be deleted or frozen) while `CopilotChat` talks to the runtime → every chat spec breaks at once with no incremental signal.
2. **`route.fulfill` streaming limitations:** Playwright's `route.fulfill()` can return a `ReadableStream` body (works for fetch-based SSE), but multiple teams report it delivers content in one chunk or closes immediately for long-lived connections — and it cannot faithfully simulate mid-stream disconnect/reconnect (native EventSource semantics). For reliable incremental delivery, a worker-scoped mock SSE server or a fetch-level `ReadableStream` with controlled enqueue timing is needed; don't discover this mid-migration.
3. **SSE framing errors:** the CopilotKit client parses the stream strictly (via the AG-UI encoder; content type negotiated by `accept` header — `text/event-stream` vs NDJSON); malformed `data:` framing silently drops events → specs assert on missing UI with confusing timeouts.
4. **Missing the bootstrap:** the client's first request is `GET /info` (agent discovery); specs that don't stub it fail before any chat interaction, and `RUNTIME_INFO_FETCH_FAILED` errors hide the real problem.
5. **Testid churn:** stable selectors are the SDK's own (`copilot-tool-render`, `data-tool-name`, `data-status`, `data-args`, `data-result`, `copilot-loading-cursor` — added to Vue recently); old spec selectors for the custom components must be rewritten against the new DOM.

**Why it happens:**
The old fixtures were elegantly typed to the old contract (`mock-api.ts` typed against `RailynAPI`), which made mocking easy and correct — but the new contract is a different protocol on different URLs, so the fixture layer must be rebuilt, not adapted.

**How to avoid:**
- Build a new fixture family: `mock-runtime.ts` stubbing `GET /info` (agents + mode) and `mock-agui.ts` emitting AG-UI event sequences (RUN_STARTED → TEXT_MESSAGE_* → TOOL_CALL_* → RUN_FINISHED / interrupt outcome) as SSE from a controlled stream; keep `WsMock` only for board events.
- Add a shared helper `emitRun(events, {delayMs})` and reuse it across specs; write one canonical "streaming works" spec first (tokens render incrementally, tool card completes) to validate the mock layer before touching the other 54.
- Keep API-level coverage (real server, `e2e/api`) for `/api/copilotkit/info` + run + connect so the UI mocks are validated against the real wire shape at least once (the existing `e2e/api/fixtures/server.ts` pattern).
- Where tests need reconnection/mid-stream interruption semantics, use a real mock SSE server fixture (worker-scoped), not `route.fulfill`.
- Assert on SDK testids + our own `data-*` attributes on ported renderers, not on the deleted custom component classes.

**Warning signs:**
- Chat specs fail en masse after the UI swap with `RUNTIME_INFO_FETCH_FAILED` or empty message lists
- Intermittent timeouts only under `fullyParallel` workers (stream fixture not worker-scoped)
- Console errors about `text/event-stream` parse failures in mocks

**Phase to address:**
Phase: **E2E Migration & Verification** — but build the runtime fixture during **CopilotRuntime Hosting & Thread APIs** (validated against the real server) so the UI phase lands on a proven mock.

---

## Technical Debt Patterns

Shortcuts that seem reasonable but create long-term problems.

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| Keep old chat tables + old RPC handlers alive and *also* write JSONL (dual-write) | Rollback safety feels free | Two sources of truth drift silently; import idempotency nightmare; every bug triaged twice | Never as a permanent state — acceptable only as a short (one phase) dual-write window with a removal ticket |
| Auto-generate threadId as `String(conversation.id)` without a versioned format | Zero mapping code | Rename/regenerate formats later → orphaned JSONL files and lost history; numeric strings collide with future UUID thread ids | Only if a single `conversationIdToThreadId()` function is the sole producer, with a migration path |
| Replay via `MESSAGES_SNAPSHOT` synthesized from a cache "for now" | Faster than event replay | Edit-based merge deletes client messages on stale caches (Pitfall 3) | Never — event replay is the documented pattern |
| Skip event IDs in JSONL lines | Smaller files | No dedup/reconnect cursor; duplicate events on reconnect; no audit trail | Never |
| Port React examples into Vue templates directly | Faster initial code | Slots vs render-props mismatch, silent no-render, v1/v2 import mixing (Pitfall 6) | Never — verify against Vue README/PARITY.md |
| Wrap every CopilotKit component in a local wrapper "for safety" | Isolation | Wrapper layer becomes a second API to maintain; indirection hides SDK behavior; 800 lines of glue for 8 usages | Only for components whose API surface Railyin actually customizes (Chat, Input, tool slots); plain passthroughs should be deleted |
| Hand-roll SSE encoding instead of `EventEncoder` | Feels simple | Framing/content-type drift breaks client parsing silently (Pitfall 11.3) | Never — use `@ag-ui/encoder` |
| Thread index file written in-place (not atomic) | One less rename | Torn index on crash → wrong sidebar, threads "missing" (Pitfall 8.2) | Only if index is rebuilt at boot from the event log |

## Integration Gotchas

Common mistakes when connecting to external services.

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| CopilotRuntime in Bun.serve | Mounting the hono handler after the `/api/*` RPC router | Dispatch CopilotKit `basePath` first in the fetch handler; verify with `/info` API test (Pitfall 9.1) |
| Bun.serve `idleTimeout: 30` | Assuming it only affects keep-alive HTTP | Long agent silences kill SSE; add heartbeats or raise/conditionalize timeout (Pitfall 9.2) |
| Vite dev server + runtime | Prod same-origin "works", dev cross-origin silently fails at `/info` | Configure CORS origins for dev or proxy `/api/copilotkit` in Vite (Pitfall 9.3) |
| `useThreads` | Assuming it lists self-hosted runner threads | Docs: custom/Sqlite runners do **not** offer the useThreads contract — build the thread-list endpoint from the index/event log (Railyin's planned fallback is correct) |
| threadId mapping | `conversation.id` (SQLite number) vs string threadId inconsistency | Single `conversationIdToThreadId()` producer; validate threadId format before it touches the filesystem (see Security) |
| Engine `decision_request` resume | Reusing old decision-response RPC as if nothing changed | Translate through `RunAgentInput.resume[]`; block non-resume runs while pending (Pitfall 5) |
| `forwardedProps` | Relying on `forwardedProps.command.resume` or injecting arbitrary props | Deprecated resume channel; use `resume[]`; forwardedProps only for stateless context (headers, workspace id) |
| Old `/ws` push (`task.updated`, `code.ref`, `lsp`) | Assuming chat events also move to `/ws` or that board events move to CopilotKit | Keep board on `/ws`; chat exclusively via CopilotKit connection (PROJECT.md decision) |

## Performance Traps

Patterns that work at small scale but fail as usage grows.

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Full JSONL replay on every connect (long threads) | Slow rehydration, big SSE bursts, janky scroll on open | Accepted for v1 (PROJECT.md defers virtualization); keep the replay bounded to the run-grouped event log and page/batch if a thread exceeds ~100k lines | Multi-hour agent runs with heavy tool output; rehydration >2–3s |
| Reading whole JSONL file per run start for context assembly | Startup latency grows with history; memory spikes | Read once at run start; keep a cached parsed tail per thread (invalidated on append); reuse `eventsToMessages` result for both context and replay | Threads with 10k+ messages; compaction cost doubles |
| Appending per-event JSONL from the hot stream path | Write syscall per token/tool event competes with engine I/O | Reuse the existing `WriteBuffer` pattern: batch appends, flush on `RUN_FINISHED`/interval — but keep flush ≤ few hundred ms so crash loss stays tiny | Sustained streaming runs (already mitigated in the old stack for 3 hot event types — replicate that) |
| Per-token SSE encode of large tool results | Memory/CPU on encode; large frames | Stream tool results in chunks (TEXT_MESSAGE_CONTENT style) rather than one giant event; cap tool-result size in the bridge | File diffs / shell output in tool results (removed features reduce this) |
| Thread-index rebuild by scanning all files at boot | Boot time grows with thread count | Defer scan until thread list is first requested; index lazily per directory mtime | Hundreds of threads (unlikely for a personal tool — monitor only) |

## Security Mistakes

Domain-specific security issues beyond general web security.

| Mistake | Risk | Prevention |
|---------|------|------------|
| Unsanitized `threadId` interpolated into `data/threads/{threadId}.jsonl` | **Path traversal** — a crafted threadId (`../../etc/passwd` or absolute path) writes/reads outside the threads dir; the runtime accepts client-supplied threadIds | Validate threadId against `^[a-zA-Z0-9_-]{1,128}$` (or `^conv-\d+$`) before any filesystem use; resolve + containment-check the final path; unit-test traversal attempts |
| CopilotKit endpoints inheriting the unauthenticated localhost surface | Local RCE/abuse via `/api/copilotkit/*` (runs agents with engine credentials) — same class as existing `launch.run` exposure | Originate from the existing security posture: loopback binding + (recommended) Origin validation on `/api/*` and `/ws` covering the copilotkit basePath; treat SSE POSTs like other API POSTs |
| Forwarding engine config/keys through `forwardedProps` or runtime headers | Key exfiltration to the browser (already flagged for `workspace.getConfig`) | Keep `forwardHeaders` denylist conservative; never forward `api_key`; runtime reads keys from server-side config only |
| JSONL files readable by other local processes (permissions) | Chat/decision content exposure on shared machines | Match the data-dir permissions used for SQLite (`~/.railyn` conventions); document in the thread-store module |
| Importing legacy `conversation_messages` containing injected content | Prompt injection from *old* messages flows into engine context | Treat imported history as untrusted data when assembling context (existing prompt-ref discipline); don't re-execute legacy tool results |

## UX Pitfalls

Common user experience mistakes in this domain.

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Pending decision interrupt blocks new input without explanation | User types, nothing happens (contract: pending interrupts block new input) | Disable input while a decision is pending; show a "decision required" affordance with the resume options (useInterrupt surfaces it) |
| Tool calls stuck "Running…" in replayed/imported threads | Looks broken; user distrusts the transcript | Synthesize results on replay/import (Pitfall 7); assert in e2e |
| Blank conversation after reload (persistence/replay bug) | Data appears lost (it isn't) | Replay contract tests (Pitfall 2); error toast with "reload" instead of silent blank |
| Thread list shows wrong "last activity" (index drift) | User opens a stale thread expecting a fresh run | Derive `lastRunAt` from event log; rebuild index from log on any inconsistency |
| Decision interrupt renders as an error (RUN_FINISHED with outcome viewed as failure) | Panic that the run broke | Map interrupt-outcome RUN_FINISHED to the decision UI explicitly; it is a normal completion with a pause |
| Run-stop button aborts but UI stays "running" (isRunning mismatch) | User clicks Stop repeatedly | Make `stop()` await engine AbortController; verify `isRunning()` flips immediately; e2e the stop path |
| Markdown differences (streamdown-vue vs old renderer) in existing messages | Previously-good messages render differently (Mermaid lost — accepted) | Port critical formatting expectations into e2e; document dropped syntax in the UI phase |

## "Looks Done But Isn't" Checklist

Things that appear complete but are missing critical pieces.

- [ ] **`connect()` replay:** returns events but wasn't tested for (a) missing file, (b) errored-run-in-history, (c) active-run tail — verify all three with unit tests before UI integration (Pitfall 2)
- [ ] **Run lock:** `run()` throws "Thread already running" — but the *client* still double-submits because SSE-mode only yields a generic 500 — verify busy-flag guard in UI and e2e (Pitfall 4)
- [ ] **Decision resume:** decision UI "works" in the happy path — verify the stranded-run case (resume sent but engine never called) and the blocked-new-input rule (Pitfall 5)
- [ ] **Tool results in history:** replayed threads show complete tool cards — verify a thread with tool calls survives reload with `status: complete` (Pitfall 7)
- [ ] **SSE survives silence:** long agent runs (60s+ no events) don't die to Bun idleTimeout — verify with a deliberately slow mocked run in e2e/API (Pitfall 9)
- [ ] **`GET /info` mocked:** every chat e2e spec stubs `/api/copilotkit/info` — a spec that forgets it fails with a misleading `RUNTIME_INFO_FETCH_FAILED` (Pitfall 11)
- [ ] **Legacy import idempotency:** clicking import twice doesn't duplicate threads/messages — verify with a repeat-import test (Pitfall 3/8)
- [ ] **ThreadId sanitization:** traversal attempts are rejected at the handler, not just "works for normal ids" — verify with a security unit test
- [ ] **Old write paths stopped:** after migration, no handler still writes `conversation_messages`/`stream_events` — grep for write call sites; the freeze must be explicit (Pitfall: dual-write drift)

## Recovery Strategies

When pitfalls occur despite prevention, how to recover.

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| JSONL corrupted (partial line) | LOW | Tolerant reader skips trailing partial line; keep a per-thread `.bak` on first rewrite; restore from git/branch rollback if needed (main repo untouched) |
| Index desync | LOW | Rebuild index from event logs at boot (design it as rebuildable); log rebuild events |
| Stranded decision run (interrupt mismatch) | MEDIUM | User-facing: allow cancelling the pending interrupt (cancel() → resume with status "cancelled"); engine-side: ensure cancel path maps to a terminal state so the thread is never permanently locked |
| Duplicate messages in client after reconnect | MEDIUM | Reconnect dedup via event IDs (if present); else full thread reload — this is why event IDs are non-negotiable (Pitfall 8.4) |
| Broken e2e mock layer discovered mid-migration | MEDIUM | Freeze chat specs; build the runtime fixture against the real server first (API tests), then unblock specs one suite at a time |
| Vue SDK parity surprise after upgrade | LOW–MEDIUM | Pinned versions + thin wrapper layer means the blast radius is one component; check package PARITY.md before upgrading; keep upgrade as its own commit |

## Pitfall-to-Phase Mapping

How roadmap phases should address these pitfalls.

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| connect-before-run / unknown threads | AG-UI Bridge & RailyinAgentRunner | Unit tests: connect() on missing/empty/existing/interrupted thread files |
| Replay validity (multi-run, RUN_ERROR, active-run tail) | AG-UI Bridge & RailyinAgentRunner | Unit tests per replay shape; API test: connect over real server replays correctly |
| MESSAGES_SNAPSHOT misuse | JSONL Persistence & Legacy Import | Unit test asserting snapshot merge semantics; import idempotency test |
| Run locking / concurrency | AG-UI Bridge & RailyinAgentRunner | Backend test: two concurrent runs → second throws; e2e: double-submit guarded |
| Interrupt contract mismatch | Decision Interrupts & Resume | Fake-engine pause/resume test; e2e: decision → resume → engine output continues |
| Vue early-access gaps | Chat UI Replacement (Vue) | Spike phase validating every needed hook/component against Vue README; pinned versions |
| Tool-call slot replay vs live | Chat UI Replacement (Vue) + JSONL Persistence & Legacy Import | e2e: replayed thread shows complete tool cards; regression for interleaved tool calls |
| JSONL atomicity/corruption/index drift | JSONL Persistence & Legacy Import | Unit tests: truncated file, crash recovery, index rebuild, traversal rejection |
| Runtime hosting (routing/idle/CORS/SSE) | CopilotRuntime Hosting & Thread APIs | API e2e: /info, run, connect over real Bun server; slow-run SSE survival test |
| History readback for context assembly | AG-UI Bridge & RailyinAgentRunner | eventsToMessages unit suite; cross-engine transfer regression tests |
| E2E mock migration | E2E Migration & Verification (fixture built earlier in Runtime Hosting phase) | One canonical streaming spec first; then per-suite migration; full suite green |

## Sources

- AG-UI official docs — interrupts concept (`docs.ag-ui.com/concepts/interrupts`, `ag-ui-protocol/ag-ui` GitHub `docs/concepts/interrupts.mdx`): RUN_FINISHED outcome contract, resume[] rules, legacy on_interrupt channel, stranded-run warning
- AG-UI LangGraph TypeScript integration README (`ag-ui-protocol/ag-ui/integrations/langgraph/typescript`): emitInterruptOutcome opt-in rationale, legacy `on_interrupt` custom event, deprecation of `forwardedProps.command.resume`
- CopilotKit official runtime docs — `agent-runners.md` / `agent-runners-custom.md` / `agent-runners-sqlite.md` (packages/runtime + @copilotkit/sqlite-runner): AgentRunner contract, "Thread already running", SSE-mode 500 vs Intelligence 409, connect-must-replay, unknown-thread empty snapshot (also in official troubleshooting docs, `docs.showcase.copilotkit.ai/troubleshooting/common-issues`)
- CopilotKit `AgentCoreRunner` source (`packages/agentcore-runner/src/agentcore-runner.ts`): reference pattern for unknown threads + synthesized TOOL_CALL_RESULT
- CopilotKit GitHub issues: #3553 (InMemoryAgentRunner.connect serverless session loss, PR #3895), #3928 (duplicate toolCallId on replay), #3644 (duplicate assistant message IDs, interleaved tool calls), #4943 (hydration fails with RUN_ERROR in replay, PR #4969), #2200 (thread history leak / stale thread_state cache), PR #3173 (fetchRunHistory + convertMessagesToEvents)
- CopilotKit docs — Vue reference (`docs.showcase.copilotkit.ai/reference/vue`, `packages/vue/README.md`, `PARITY.md`), PR #4357/#4400 (Vue port + parity gaps), PR #5110 (Vue testids `copilot-tool-render`, `copilot-loading-cursor`)
- CopilotKit runtime endpoints doc (`docs/showcase.../backend/runtime-endpoints.mdx`, runtime-debugging reference): GET /info bootstrap, agent run/connect endpoints; `CopilotKitCoreErrorCode` reference; `useThreads` docs (self-managed runners lack the contract)
- Playwright SSE mocking community reports: assrt.ai "How to Test AI Chat Streaming UI with Playwright" (route.fulfill + ReadableStream), QASkills.sh "Mock a Server-Sent Events Stream in Playwright" (route.fulfill limitation analysis, worker-scoped SSE fixture), Azure LogicAppsAgentChat `E2E_TESTING_FINDINGS.md` (route.fulfill cannot simulate long-lived SSE)
- Codebase analysis (`.planning/codebase/ARCHITECTURE.md`, `CONCERNS.md`, `TESTING.md`, `PROJECT.md`): Bun.serve idleTimeout 30, WS-only push today, e2e fixture design (mock-api.ts/mock-ws.ts), conversation dual-layer stores, orchestrator cancel races, cross-engine context transfer fragility

---
*Pitfalls research for: Railyin chat-stack migration to AG-UI + CopilotKit (Vue) with custom JSONL AgentRunner and self-hosted CopilotRuntime*
*Researched: 2026-08-08*
