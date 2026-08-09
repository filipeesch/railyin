# Project Research Summary

**Project:** Railyin — CopilotKit/AG-UI Chat Stack Rework
**Domain:** Local-first single-process agent-chat + workflow board (Bun + Vue 3) — migrating a hand-rolled chat stack (~8.2k lines) to AG-UI wire protocol + CopilotKit, keeping the board, decision-request workflow, and five pluggable engine adapters intact
**Researched:** 2026-08-08
**Confidence:** MEDIUM overall (Stack: HIGH; Features/Architecture/Pitfalls: MEDIUM)

## Executive Summary

Railyin is a single-process, local-first delivery-orchestration tool: a Kanban board whose task cards are executed by five pluggable AI coding engines (pi/claude/copilot/cursor/opencode) that stream normalized `EngineEvent`s to a Vue 3 frontend. This milestone replaces the hand-rolled chat stack (custom `StreamEvent` protocol, dual-layer conversation store, custom UI, SQLite chat storage) with the AG-UI protocol + CopilotKit — the standard three-layer shape: Vue SPA ↔ `CopilotRuntime` (HTTP + SSE) ↔ custom `AgentRunner` ↔ custom `AbstractAgent` bridging to the existing engine adapters. All research files agree on this architecture and on the fact that the whole migration hinges on one bespoke keystone: a custom `RailyinAgentRunner` (subclass of `InMemoryAgentRunner` — the documented extension pattern, per AWS's official `AgentCoreRunner`) with per-thread JSONL persistence.

The recommended approach, in dependency order: (1) pin exact versions (`@ag-ui/core`/`@ag-ui/client@0.0.57`, `@copilotkit/runtime`/`@copilotkit/vue@1.66.4` — the Vue SDK is early-access and version-sensitive), mount `CopilotRuntime` inside `Bun.serve`, and spike the wire surface; (2) build the pure `EngineEvent → AG-UI event` bridge plus the runner (JSONL persist/replay, unknown-thread connect, synthesized tool results, run lock); (3) port `decision_request` to the canonical AG-UI interrupt outcome + `resume[]`; (4) harden the JSONL store and build legacy import; (5) the big-bang frontend swap to `CopilotChat` + slots behind thin local wrappers; (6) rework the 55 Playwright specs against the new protocol; (7) cleanup. Rollback is preserved by keeping old chat tables frozen (never dropped) until the swap is verified.

Key risks, all researched with mitigations: version-sensitive early-access Vue SDK (pin exact + wrap + check `PARITY.md`); the runner's connect/replay contracts (connect-before-run, multi-run replay rejection, `MESSAGES_SNAPSHOT` edit-merge semantics — all with documented failure modes and test plans); hosting SSE inside `Bun.serve` (routing order, the `idleTimeout: 30` silent killer, dev CORS); run-lock concurrency ("Thread already running" surfaces as a generic 500 in SSE mode); `useThreads` being unavailable on self-hosted runtimes (own thread-index endpoint is the reliable path); and the e2e fixture rebuild (mock the runtime boundary, not the deleted RPC layer). One **decision change** emerged: STACK.md (HIGH confidence) contradicts PROJECT.md's "hono handler" decision — the fetch-native `createCopilotRuntimeHandler` mounts in `Bun.serve` with zero new dependencies; adopt it and update PROJECT.md, with hono only if middleware needs ever appear.

## Key Findings

### Recommended Stack

**Confidence: HIGH** (versions verified against npm registry + official docs on 2026-08-08). The stack is a tight version-locked family: CopilotKit pins `@ag-ui/core` exactly, and runtime+vue must stay on the same release line — do not bump AG-UI independently.

**Core technologies:**
- `@ag-ui/core@0.0.57` (pin exact): AG-UI wire-protocol types (zod schemas for all events, `RunAgentInput`) — the standard the whole stack is built on; replaces Railyin's home-grown `StreamEvent` subset.
- `@ag-ui/client@0.0.57` (pin exact): `AbstractAgent`, `BaseEvent`, `HttpAgent` — the `AgentRunner` contract returns `Observable<BaseEvent>` from here; direct dependency of the custom runner.
- `@copilotkit/runtime@1.66.4` (import from `/v2`): `CopilotRuntime`, `InMemoryAgentRunner`, `createCopilotRuntimeHandler` (fetch-native) — fully self-hosted, no cloud. **Recommend fetch-native handler over the hono handler PROJECT.md assumed** (contradiction flagged in STACK.md; hono only if HTTP middleware needs grow).
- `@copilotkit/vue@1.66.4` (import from `/v2`): `CopilotKitProvider`, `CopilotChat` + slots (`#interrupt`, `#tool-call-*`), `CopilotChatInput`, `useInterrupt`, `useDefaultRenderTool` — only official Vue 3 SDK; early-access, pin exact and wrap in thin local components.
- `rxjs@^7.8.2`: required peer of the `AgentRunner` observable contract.
- `zod@^3.25` (transitive via `@ag-ui/core`): runtime-validate bridge output.
- **Not used:** `useThreads` (Intelligence-only), Copilot Intelligence, `@copilotkit/sqlite-runner` (native better-sqlite3, second SQLite stack), React packages, all v1 APIs, attachments (known Vue bug #6104).

### Expected Features

**Confidence: MEDIUM** (official docs + cross-checked 2026 UX baselines; some Vue API surface unconfirmed).

**Must have (table stakes) — all P1:**
- Token-by-token streaming chat (free from AG-UI text events + bridge) and stable-layout markdown + code blocks (default renderer; verify quality vs old CodeMirror)
- Tool-call visibility via `useDefaultRenderTool` expandable card (status/args/result)
- Cancel/stop (runner `stop()` → engine abort; per-engine abort semantics need verification)
- Threads + per-thread JSONL persistence (custom runner — no official JSONL runner) and thread history/listing (own index endpoint; `useThreads` is a documented dead end self-hosted)
- **decision_request as AG-UI interrupt** — core product value, non-negotiable: `RUN_FINISHED` with interrupt outcome + `resume[]`; run pauses, not ends
- Reasoning/thinking display (zero-config `CopilotChatReasoningMessage`; pi engines already emit thinking)
- Slash commands / prompt-refs parity (must not regress) and legacy-import button (old tables frozen, not dropped)

**Should have (differentiators):**
- Card↔thread integration (threadId = conversation.id; no other CopilotKit app does board-native chat)
- Decision cards as interrupt UI with structured approve/reject payload
- Ported domain tool renderers (shell/file/delegate) as `#tool-call-*` slots
- Five engines behind one AG-UI boundary (the migration's raison d'être)

**Defer (v1.x / v2+):**
- Regenerate/retry (P2 — no confirmed Vue v2 API; fallback = JSONL replay, cheap once persistence exists), cancel hardening, suggestions, thread-list niceties, attachments
- v2+: A2UI generative UI, MCP Apps, long-thread virtualization, Mermaid (accepted loss), multi-client sync
- **Anti-features (record as non-goals):** frontend tools, realtime multi-client sync, shared-state streaming, voice, rebuilding trimmed features (file_diff, usage, status, etc.)

### Architecture Approach

**Confidence: MEDIUM.** Fixed three-layer ecosystem shape: frontend never talks to the LLM — `CopilotKitProvider` → `CopilotRuntime` HTTP endpoints (run/connect/stop/info, AG-UI events over SSE) → `AgentRunner` (thread lifecycle + persistence) → custom `AbstractAgent` (execution, cloned per request). The runtime clones the registered agent per request, so per-thread state lives in the runner's store, not the agent.

**Major components (new `src/bun/copilotkit/` + thin Vue wrappers, ~800–1000 LOC):**
1. `railyin-agent.ts` — `AbstractAgent` subclass: `RunAgentInput` → existing orchestrator (`conversationId = threadId`) → `EngineEvent` → AG-UI events; `abortRun()` via AbortController
2. `event-bridge.ts` — pure, unit-testable `EngineEvent → BaseEvent` translation (token→TEXT_MESSAGE_CHUNK, reasoning→REASONING_MESSAGE_CHUNK, tool lifecycle→TOOL_CALL_*, decision→interrupt outcome)
3. `railyin-runner.ts` — `InMemoryAgentRunner` subclass: JSONL persist/replay, unknown-thread connect (empty RUN_STARTED→SNAPSHOT→RUN_FINISHED sequence), synthesized `TOOL_CALL_RESULT`s on replay, run lock ("Thread already running"), `listThreads()` override
4. `jsonl-store.ts` — buffered single-writer appends, tolerant reader, rebuildable index, stable event IDs
5. `runtime.ts` + `import.ts` — `CopilotRuntime` mount in `Bun.serve` fetch dispatch (before `/api/*` RPC, `basePath: "/api/copilotkit"`); legacy table → JSONL conversion
6. Frontend: `RailyinChat.vue` (CopilotChat + slots), `DecisionInterrupt.vue`, tool-call renderers; board stays on `/ws` (task.updated/code.ref/lsp), chat exclusively via CopilotKit connection

Key patterns: runner subclass as persistence seam; custom agent as execution bridge (stateless per request); busy-flag concurrency guard; interrupt slot + `resume[]` for HITL. Anti-patterns to avoid: reimplementing `AgentRunner` from scratch, stateful agents, expecting `useThreads` self-hosted, aborting the engine on interrupt, double-broadcasting chat events over `/ws`.

### Critical Pitfalls

**Top 5 (of 11 critical, full list in PITFALLS.md with per-phase mapping):**

1. **Connect-before-run 404s** — custom runner errors on threads that never ran; return the canonical empty sequence (`RUN_STARTED` → empty `MESSAGES_SNAPSHOT` → `RUN_FINISHED`) like AgentCoreRunner; unit-test all four file states.
2. **Replay shapes the AG-UI client rejects** — multi-run/errored-run replays throw `verifyEvents` errors (#4943); persist per-event as streaming (not run-end), structure replay as per-run blocks, test each shape against the pinned client.
3. **Run-lock concurrency** — `run()` must throw "Thread already running"; in SSE mode this surfaces as a generic 500 (no typed code) so the client needs a busy-flag guard; map board-execution vs chat-run overlap explicitly.
4. **Interrupt contract mismatch strands runs** — go all-canonical: `RUN_FINISHED` interrupt outcome + `RunAgentInput.resume[]`; never the legacy `on_interrupt`/`forwardedProps.command.resume`; enforce "pending interrupt blocks new input"; one resume array must address all open interrupts.
5. **SSE hosting in Bun.serve** — mount the handler **first** (routing order); raise/condition `idleTimeout: 30` (silent mid-run stream death on long engine silences — add heartbeat frames); explicit dev-origin CORS for Vite; keep the handler un-wrapped by body-consuming middleware.

Also critical: `MESSAGES_SNAPSHOT` edit-merge semantics (replay events, don't synthesize snapshots); JSONL atomicity/corruption/index drift (tolerant reader, atomic index, event IDs — non-negotiable for dedup); Vue early-access parity gaps (v2 imports only, React docs directional, PARITY.md); tool-call slots desync on replay (synthesize results); context assembly from JSONL (`eventsToMessages` with run-grouped dedupe); e2e mock migration (rebuild fixtures against `/api/copilotkit/*`, one canonical streaming spec first, worker-scoped SSE mock not `route.fulfill`).

## Implications for Roadmap

The four research files converge on the same spine (ARCHITECTURE build order: spike → bridge → interrupts → frontend swap → cleanup) with pitfall-assigned phases. Recommended structure — 7 phases:

### Phase 1: CopilotRuntime Hosting & Thread APIs (Spike)
**Rationale:** Everything rides on the runtime mount; the riskiest unknowns are version-sensitive and must be resolved with evidence before any bespoke code: exact routes (`POST /agent/:id/stop` path shape), thread-endpoint capability (`listThreads()`/`GET /threads` in the pinned version), handler choice, and Bun.serve hosting behavior.
**Delivers:** Pinned exact versions; `CopilotRuntime` mounted in `Bun.serve` (`/api/copilotkit` basePath, dispatched first); verified `/info` + run + connect + stop over SSE from a scratch page; CORS for Vite dev + idleTimeout mitigation verified; thread-listing decision made (own endpoint vs `listThreads()` fallback); e2e API fixture + `mock-runtime.ts`/`mock-agui.ts` fixture foundation (per Pitfall 11, built now so the UI phase lands on a proven mock).
**Addresses (FEATURES):** Hosting requirement; enables every P1 feature.
**Avoids:** Pitfall 9 (routing order / idleTimeout / CORS / SSE framing), Pitfall 11.4 (missing `/info` stub).
**Uses (STACK):** `@copilotkit/runtime/v2` fetch-native handler (`createCopilotRuntimeHandler`) — **resolve the hono contradiction with PROJECT.md here**.

### Phase 2: AG-UI Bridge & RailyinAgentRunner
**Rationale:** The runner is the keystone — persistence, thread mapping, interrupts, cancel, regenerate all flow through it; it should be the first thing built and the most heavily tested (FEATURES dependency notes). Bridge + runner are the only genuinely bespoke code.
**Delivers:** `event-bridge.ts` (pure translation, unit tests); `railyin-agent.ts` (orchestrator bridge); `railyin-runner.ts` (JSONL persist-per-event, connect replay, unknown-thread empty sequence, synthesized `TOOL_CALL_RESULT`s, run lock, `stop()`/`isRunning()`); `eventsToMessages` context assembly replacing `conversation_messages` reads; baseline `jsonl-store`.
**Addresses:** AG-UI wire protocol, five engines behind one boundary, JSONL storage baseline, thread mapping (threadId = conversation.id).
**Avoids:** Pitfalls 1, 2, 4, 10 (connect-before-run, replay validity, run locking, history readback) + anti-patterns 1, 2, 5.
**Implements (ARCHITECTURE):** Components 1–4; Patterns 1–3.

### Phase 3: Decision Interrupts & Resume
**Rationale:** Core product value and the only HITL channel; self-contained bridge mapping (FEATURES: doesn't depend on tool slots or reasoning display) but depends on a working bridge. Dedicated phase so contract tests with a fake engine can prove pause → render → resume → continuation.
**Delivers:** Canonical interrupt outcome (`RUN_FINISHED` `outcome.type:"interrupt"`, `reason:"decision_request"`, payload = decision options); `resume[]` → engine decision-response translation; `useInterrupt` + `#interrupt` slot with ported decision renderer; pending-interrupt blocks new input (server-side + disabled input); board-card decision entry points resume via the CopilotKit path.
**Avoids:** Pitfall 5 (stranded runs, partial resumes, wrong channel) + anti-pattern 4 (abort-on-interrupt).
**Addresses:** decision_request HITL (P1, non-negotiable) + decision-cards differentiator.

### Phase 4: JSONL Persistence & Legacy Import
**Rationale:** File-store correctness is subtle (crash tolerance, single-writer discipline, index rebuild, event IDs — Pitfall 8) and legacy import is a user-facing requirement; harden the store before the UI swap so the UI lands on a proven persistence layer. (Can be folded into Phase 2 if fewer phases are preferred — flag to roadmapper.)
**Delivers:** Crash-tolerant `jsonl-store` (tolerant trailing-line reader, buffered single-writer appends via existing `WriteBuffer` pattern, atomic index rebuildable from the log, stable per-event IDs); thread-index endpoint (`GET /api/threads` reading the JSONL dir — the reliable `useThreads` replacement; opportunistically use `listThreads()` if the spike shows it); legacy-import button (read-only over frozen tables → JSONL with reconciled tool results, idempotent, repeat-import tested); threadId sanitization (`^[a-zA-Z0-9_-]{1,128}$` + containment check).
**Avoids:** Pitfalls 3, 8 (snapshot misuse, atomicity/corruption/index drift) + security mistakes (path traversal, injected legacy content).
**Delivers:** Regenerate/retry (P2) nearly free via JSONL replay — natural home for it.

### Phase 5: Chat UI Replacement (Vue)
**Rationale:** The big-bang swap must wait until the wire protocol is proven (Phase 2/3) and persistence is hardened (Phase 4) — rollback depends on old code surviving until the swap is verified. Early-access Vue SDK demands thin wrappers and parity verification.
**Delivers:** `RailyinChat.vue` (CopilotChat + slots incl. `#interrupt`, `#tool-call-*`, `#input`); `CopilotChatInput` with tools menu (slash commands/prompt-refs parity); ported shell/file/delegate renderers; thread sidebar; reasoning display; delete old conversation/chat stores + CodeMirror editor + block-tree code; keep board `/ws` reactivity.
**Addresses:** Streaming, markdown, tool-call cards, reasoning, slash commands (all P1).
**Avoids:** Pitfall 6 (Vue early-access gaps: v2-only imports, React docs as directional, silent failures) + Pitfall 7 (tool-slot desync) + UX pitfalls (busy-state affordances, decision-pending input blocking).
**Research flag:** regenerate API must be verified against the pinned Vue package before implementation.

### Phase 6: E2E Migration & Verification
**Rationale:** 55 specs hand-mock the old protocol; the new contract is a different protocol on different URLs, so the fixture layer must be rebuilt, not adapted. The fixture foundation is built in Phase 1 (validated against the real server); this phase migrates specs onto it.
**Delivers:** `mock-runtime.ts` (stub `GET /info` agents+mode), `mock-agui.ts` (SSE AG-UI event sequences from a controlled stream), shared `emitRun(events, {delayMs})` helper, worker-scoped SSE fixture for reconnect/mid-stream tests (not `route.fulfill`), one canonical "streaming works" spec first, then per-suite migration; asserts on SDK testids (`copilot-tool-render`, `data-status`, `copilot-loading-cursor`).
**Avoids:** Pitfall 11 (wrong-boundary mocking, route.fulfill limits, SSE framing, missing /info, testid churn) + "looks done but isn't" checklist items.
**Can overlap with Phase 5** (specs migrate as the UI swaps).

### Phase 7: Cleanup & Feature Trim
**Rationale:** Rollback requires old code to survive until the swap is verified — cleanup is deliberately last.
**Delivers:** Remove `StreamEvent` protocol, stream-tree, `markClaudeExecution`, trimmed features (file_diff, code_review, transition_event, status, usage, compaction_summary, ask_user, shell_approval) and dead engine bits (FileStateCache, shell gate, code-review executor); freeze old chat tables (stop writes, no drops); retire legacy import behind a flag when imports complete; `git grep` shows zero custom-protocol references; 55 specs green against new mocks.
**Avoids:** Dual-write drift (technical-debt table: never dual-write as a permanent state).

### Phase Ordering Rationale

- **Dependency chain:** runtime mount (enabling layer) → bridge+runner (risky bespoke core) → interrupts (needs bridge) → persistence/import (needs runner; harden before UI) → UI swap (big-bang, waits for proven wire) → cleanup (rollback needs old code alive until swap verified).
- **Runner is the keystone:** persistence, thread mapping, interrupts, cancel, regenerate all flow through it — build first, test most (FEATURES dependency graph).
- **Interrupts isolated:** decision_request ↔ interrupt/resume is self-contained and doesn't block UI work; dedicated phase per PITFALLS mapping so contract tests get a fake-engine focus.
- **e2e fixture foundation early:** the runtime mock layer is built in Phase 1 against the real server (Pitfall 11) so the UI phase never discovers a broken mock layer mid-swap.
- **Anti-features recorded as non-goals** in requirements (frontend tools, realtime sync, A2UI, MCP Apps, attachments) so they never get proposed in a phase.

### Research Flags

Phases needing deeper research during planning (`/gsd-plan-phase --research-phase`):
- **Phase 1:** version-sensitive runtime details — verify `POST /agent/:id/stop` path shape, `listThreads()`/`GET /threads` capability, and SSE `idleTimeout` behavior against the **installed pinned packages**, not docs; resolve fetch-vs-hono handler decision (STACK.md contradicts PROJECT.md).
- **Phase 2:** verify `AbstractAgent` clone/statelessness semantics, `compactEvents`/`finalizeRunEvents` from the installed source, multi-run replay behavior on pinned `@ag-ui/client` (issue #4943 fix status), and per-engine abort/stop semantics (spike `stop()` for all five adapters).
- **Phase 5:** CopilotKit Vue early-access — regenerate API unconfirmed, React-vs-Vue parity (PARITY.md), `streamdown-vue` markdown rendering differences, slot-vs-render-prop pitfalls, testid churn.
- **Phase 6:** Playwright SSE mocking patterns (community reports on `route.fulfill` limits; worker-scoped SSE fixture design).

Phases with standard patterns (skip research-phase):
- **Phase 3:** interrupt contract is well-documented (official AG-UI docs, HIGH confidence) — verify `useInterrupt` composable against the Vue README during planning only.
- **Phase 4:** file-store and import patterns are standard; codebase already mapped (`.planning/codebase/`).
- **Phase 7:** mechanical deletion; no research needed.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Versions verified against npm registry + official docs on 2026-08-08; version-lock constraints (AG-UI pinned by CopilotKit; runtime+vue same line) are explicit |
| Features | MEDIUM | Official CopilotKit/AG-UI docs via Context7 + cross-checked 2026 UX baselines; some Vue v2 API surface unconfirmed (regenerate; useThreads capability) |
| Architecture | MEDIUM | Context7 + official docs + GitHub/UNPKG source dumps cross-checked; version-sensitive details flagged inline (stop route, listThreads, agent cloning) |
| Pitfalls | MEDIUM | Protocol contract details verified against official docs + AG-UI source; several items from GitHub issues/community reports (still consistent across sources) |

**Overall confidence:** MEDIUM — the stack choice and architecture shape are solid (HIGH-confidence stack evidence), but the Vue SDK is early-access and several contract details are version-sensitive, so spike verification in Phase 1/2 is mandatory rather than optional.

### Gaps to Address

- **Handler choice contradiction:** STACK.md (HIGH) recommends fetch-native `createCopilotRuntimeHandler`; PROJECT.md/ARCHITECTURE.md assume hono. Recommend fetch-native (zero deps, Bun-native); update PROJECT.md decision during Phase 1 planning.
- **Regenerate/retry API:** unconfirmed in CopilotKit Vue v2 docs — verify against pinned package; fallback (JSONL replay + re-run) is cheap once Phase 2/4 exist.
- **Thread listing:** `useThreads` is Intelligence-only; decide own endpoint vs `listThreads()` local fallback after the Phase 1 spike capability check (plan for own endpoint as reliable path).
- **Multi-run replay on pinned `@ag-ui/client`:** issue #4943 fix landed in `@copilotkit/core@1.57.3` — verify against pinned 1.66.4; do not assume.
- **Vue parity matrix:** check the installed package's `PARITY.md` before each pinned-version upgrade; budget a parity-surprise buffer in the UI phase.
- **Engine abort semantics:** differ per engine SDK — spike `stop()` for all five adapters before wiring the UI stop button.
- **Markdown renderer differences:** `streamdown-vue` vs old CodeMirror-based rendering — verify quality in Phase 5 spike; Mermaid loss is accepted (PROJECT.md Out of Scope).

## Sources

### Primary (HIGH confidence)
- npm registry (verified 2026-08-08) — exact versions: `@ag-ui/core@0.0.57`, `@ag-ui/client@0.0.57`, `@copilotkit/runtime@1.66.4`, `@copilotkit/vue@1.66.4`, peer deps (vue >=3.3, runtime SDK peers optional, rxjs 7.x)
- [docs.showcase.copilotkit.ai useThreads reference](https://docs.showcase.copilotkit.ai/reference/v2/hooks/useThreads) — Intelligence-mode requirement, capability gating, self-managed runners lack the contract
- [docs.showcase.copilotkit.ai AgentRunner and persistence](https://docs.showcase.copilotkit.ai/a2a/backend/agent-runner) — subclass-InMemoryAgentRunner pattern, connect-before-run, AWS AgentCoreRunner example
- [docs.copilotkit.ai langgraph-python/threads](https://docs.copilotkit.ai/langgraph-python/threads) — Rich Threads = Enterprise Intelligence; self-hosting requirements
- [AG-UI protocol docs](https://github.com/ag-ui-protocol/ag-ui) — `docs/concepts/events.mdx`, `docs/concepts/interrupts.mdx` (RUN_FINISHED interrupt outcome, resume[] rules, legacy channel deprecation)

### Secondary (MEDIUM confidence)
- Context7 `/copilotkit/copilotkit` + `/ag-ui-protocol/ag-ui` references — AgentRunner contract, custom-runner guide, runtime endpoints, HITL docs, Vue package README/PARITY.md, MCP Apps, attachments
- CopilotKit GitHub issues: #3553 (connect cold-start), #3928 (duplicate toolCallId), #3644 (interleaved tool calls), #4943 (RUN_ERROR replay hydration), #6104 (Vue attachments), #6125 (cloneForThread), #1169 (Vue support saga); PRs #3173, #4357/#4400 (Vue port), #5110 (testids)
- CopilotKit `AgentCoreRunner` source (`packages/agentcore-runner/src/agentcore-runner.ts`) — reference pattern for unknown threads + synthesized tool results
- Playwright SSE mocking community reports (assrt.ai, QASkills.sh, Azure LogicAppsAgentChat findings) — `route.fulfill` limitations, worker-scoped SSE fixtures
- 2026 agentic-UX articles (AYDesign, Zylos Research, Agentic Forge, bobkov.dev) — cross-checked, consistent streaming/tool-visibility baseline
- Codebase analysis (`.planning/codebase/ARCHITECTURE.md`, `CONCERNS.md`, `TESTING.md`, PROJECT.md) — idleTimeout 30, WS-only push, e2e fixture design, orchestrator races, cross-engine context fragility

### Tertiary (LOW confidence)
- Microsoft 365 Copilot MCP Apps announcement (devblogs.microsoft.com, 2026-04-07) — corroborating only
- GitHub issue #6125 Vue docs mismatch — community report, flagged for in-phase verification

---
*Research completed: 2026-08-08*
*Ready for roadmap: yes*
