# Roadmap: Railyin — CopilotKit/AG-UI Chat Stack Rework

## Overview

Railyin's hand-rolled chat stack (~8.2k lines: custom `StreamEvent` protocol, dual-layer conversation store, custom chat UI, SQLite chat storage) is swapped for the AG-UI wire protocol + CopilotKit (self-hosted runtime, custom runner, Vue chat components) while the board, task-card workflow, decision-request UX, and five pluggable engine adapters keep working end-to-end. The journey follows dependency order: prove the runtime mount and pinned stack (spike) → build the bridge + custom `RailyinAgentRunner` keystone → port decision requests to canonical AG-UI interrupts → harden JSONL persistence and build legacy import → big-bang frontend swap → migrate the E2E suite → cleanup. Rollback is preserved throughout: old chat tables stay frozen (never dropped) and the old chat stack code stays alive until the swap passes E2E.

## Phases

**Phase Numbering:**

- Integer phases (1, 2, 3): Planned milestone work
- Decimal phases (2.1, 2.2): Urgent insertions (marked with INSERTED)

- [x] **Phase 1: CopilotRuntime Hosting & Thread APIs (Spike)** - Pin the stack; mount CopilotRuntime inside Bun.serve; prove run/connect/stop over SSE; validate mock fixture foundation (completed 2026-08-09)
- [x] **Phase 2: AG-UI Bridge & RailyinAgentRunner** - All five engines behind one AG-UI boundary; JSONL persistence, replay, run lock, complete tool-call lifecycle (completed 2026-08-09)
- [x] **Phase 3: Decision Interrupts & Resume** - decision_request as canonical AG-UI interrupts: runs pause, user approves/rejects, runs resume with payload; fake-engine contract tests (completed 2026-08-09)
- [x] **Phase 4: JSONL Persistence & Legacy Import** - Crash-tolerant store, thread-index endpoint, idempotent legacy import over frozen tables (completed 2026-08-09)
- [x] **Phase 5: Chat UI Replacement (Vue)** - Big-bang swap to CopilotChat + slots; streaming, tool cards, reasoning, slash commands, history; board /ws intact (completed 2026-08-09)
- [ ] **Phase 6: E2E Migration & Verification** - Migrate the 55 Playwright specs onto the new mock fixture foundation; all suites green on the new stack
- [ ] **Phase 7: Cleanup & Feature Trim** - Delete the old chat stack and trimmed features; freeze old tables; zero custom-protocol references

## Phase Details

### Phase 1: CopilotRuntime Hosting & Thread APIs (Spike)

**Goal**: CopilotRuntime runs inside the existing Bun.serve server on the pinned AG-UI/CopilotKit stack, with run/connect/stop proven over SSE and mock fixtures validated against the real server
**Mode**: mvp
**Depends on**: Nothing (first phase)
**Requirements**: HOST-01, HOST-02, HOST-03
**Success Criteria** (what must be TRUE):

  1. User starts `bun run dev` and the app serves `/api/copilotkit/*` from the same single Bun.serve origin — no second server process
  2. A scratch probe client can start an agent run over SSE and receive AG-UI events streaming back (run, connect, and stop round-trip works)
  3. Long SSE streams survive extended engine silences without mid-stream kills (Bun `idleTimeout` mitigated)
  4. Exact versions of `@ag-ui/core`, `@ag-ui/client`, `@copilotkit/runtime`, `@copilotkit/vue` are pinned; the fetch-native vs hono handler decision is recorded with evidence in PROJECT.md
  5. Mock runtime fixtures (mock-runtime/mock-agui) are validated against the real server and usable as the E2E foundation

**Plans**: 3/3 plans executed
Plans:
**Wave 1**

- [x] 01-01-PLAN.md — Pin the exact AG-UI/CopilotKit stack with a human-verified install gate and a pins lock test (HOST-03)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 01-02-PLAN.md — Mount CopilotRuntime in Bun.serve (fetch-native, /api/copilotkit/*, srv.timeout(req,0)) and prove run/connect/stop over SSE + silence survival (HOST-01, HOST-02)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 01-03-PLAN.md — Build + byte-diff-validate the MockAgui fixture foundation and record HOST-03 evidence in PROJECT.md (HOST-01, HOST-03)

### Phase 2: AG-UI Bridge & RailyinAgentRunner

**Goal**: All five engines stream through one AG-UI boundary via the custom `RailyinAgentRunner`; conversations persist per-thread as JSONL with replay, run locking, and a complete tool-call lifecycle
**Mode**: mvp
**Depends on**: Phase 1
**Requirements**: BRDG-01, BRDG-02, BRDG-03, RUNR-01, RUNR-02, RUNR-03, RUNR-04, RUNR-05, RUNR-06, RUNR-07
**Success Criteria** (what must be TRUE):

  1. User can run a task on any of the five engines and watch normalized AG-UI events (text tokens, reasoning, tool lifecycle) flow through the bridge — exactly one translation path, no double-broadcast
  2. User's card conversations persist to `data/threads/{conversation.id}.jsonl`; standalone sessions become threads without a taskId
  3. User can reload/reconnect mid-run and the full conversation replays from the JSONL event log with no stale "running" tool cards (tool results synthesized)
  4. Connecting to a thread that never ran returns an empty conversation snapshot instead of an error
  5. Starting a second concurrent run on the same thread is rejected with a clear error

**Plans**: 3/3 plans executed
Plans:
**Wave 1**

- [x] 02-01-PLAN.md — RailyinAgent run path: execution seam (onEngineEvent/onRunEnd through executeChatTurn), pure event-bridge, D-12 registration + mock-engine scenarios + real-wire run tests (BRDG-01, BRDG-02, BRDG-03, RUNR-01)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 02-02-PLAN.md — Durable runner: jsonl-store (sanitized, tolerant), RailyinAgentRunner (pipe-tap persist, hot/cold/never-run connect, replay shapes), runner wiring + persistence/replay/lock e2e (RUNR-02, RUNR-03, RUNR-04, RUNR-05, RUNR-06, RUNR-07)
- [x] 02-03-PLAN.md — Production hardening: workspace-key resolver, advisory cross-path lock, rxjs pin, full-suite phase gate + COVERAGE.md/VALIDATION.md close-out (BRDG-01, RUNR-03, RUNR-04)

### Phase 3: Decision Interrupts & Resume

**Goal**: decision_request is the only human-in-the-loop channel, implemented as canonical AG-UI interrupts rendered through CopilotKit's Vue interrupt slot: runs genuinely pause, users approve/reject with structured payloads, and runs resume — proven by fake-engine contract tests
**Mode**: mvp
**Depends on**: Phase 2
**Requirements**: RUNR-08, CHAT-09, UI-03, VERF-01
**Success Criteria** (what must be TRUE):

  1. User receives a decision request as a structured interrupt card with options; the engine run genuinely pauses (no further tokens or tool calls)
  2. User can approve or reject with a payload; the run resumes and the engine receives the decision response via `RunAgentInput.resume[]`
  3. While an interrupt is pending, the user cannot send new input (enforced server-side and in the disabled chat input)
  4. Contract tests with a fake engine prove the full decision cycle — events, interrupt outcome, resume, and replay — end to end

**Plans**: 3/3 plans executed
Plans:
**Wave 1**

- [x] 03-01-PLAN.md — Interrupt outcome emission (tracer): decision_request → RUN_FINISHED outcome.interrupt via buildInterruptOutcome + module-level registry + agent finishInterrupt; block-while-pending + Pitfall-5 guard (RUNR-08, CHAT-09, UI-03, VERF-01)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 03-02-PLAN.md — Resume: translateResumeToSubmission pure helper, A6 executeHumanTurn opts seam, agent resume branch (D-05 validation, cancelled path, orphaned-row finalize, task/chat delivery) (RUNR-08, CHAT-09, VERF-01)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 03-03-PLAN.md — Real-wire decision-cycle e2e (tests 11-17), replay shapes + registry lazy rebuild (post-restart resume), phase gate + 03-COVERAGE/03-VALIDATION close-out (RUNR-08, CHAT-09, UI-03, VERF-01)

**UI hint**: yes

### Phase 4: JSONL Persistence & Legacy Import

**Goal**: The JSONL store is crash-tolerant and its thread index is user-accessible; legacy chat history converts on demand, idempotently, over frozen tables
**Mode**: mvp
**Depends on**: Phase 2
**Requirements**: CHAT-08, IMPR-01, IMPR-02
**Success Criteria** (what must be TRUE):

  1. User can list and open every thread (card conversations and standalone sessions) through Railyin's own thread-index endpoint
  2. User can trigger a legacy import that converts old `conversation_messages`/`stream_events` rows into JSONL threads
  3. Import is idempotent — running it again produces no duplicate threads or messages
  4. Old chat tables remain intact and readable throughout (frozen, not dropped)
  5. Interrupted or corrupted JSONL writes never lose a thread: the store tolerates trailing partial lines and the index rebuilds from the log

**Plans**: 3/3 plans executed
Plans:
**Wave 1**

- [x] 04-01-PLAN.md — Thread-index endpoint `threads.list` (tracer: store scan + contract + handler + registration + real-wire e2e); list() unit layer + crash-tolerance store scenarios (CHAT-08)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 04-02-PLAN.md — Idempotent legacy import: buildThreadLog/runLegacyImport + atomic importLog write + handler + contract + seeded-DB e2e; mapping matrix + restart-replay (IMPR-01, IMPR-02)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 04-03-PLAN.md — Crash-tolerance e2e proof (corrupted log still lists + replays, .tmp residue invisible), phase gate + 04-COVERAGE/04-VALIDATION close-out (CHAT-08, IMPR-01, IMPR-02)

### Phase 5: Chat UI Replacement (Vue)

**Goal**: The board chat is fully powered by CopilotKit components (CopilotChat + slots, CopilotChatInput) with streaming, markdown, tool-call cards, reasoning, slash commands, and full history — while board /ws reactivity keeps working and the old chat stack code survives for rollback
**Mode**: mvp
**Depends on**: Phase 4 (consumes Phase 3's interrupt slot)
**Requirements**: CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07, UI-01, UI-02, UI-04, IMPR-03
**Success Criteria** (what must be TRUE):

  1. User sees agent responses stream token-by-token in the board chat, with markdown + code blocks rendered at parity with the old editor
  2. User sees every tool call as an expandable card (name, status, args, result), with domain renderers for shell output, file changes, and delegate task summaries (not raw JSON cards)
  3. User can stop a running response (propagates to the engine best-effort, partial response labeled); agent reasoning/thinking displays out of the box
  4. User can use slash commands and `/prompt-name` refs at parity (ref must be the entire leading value), and reopen any card or session to see full conversation history across app restarts
  5. Board `/ws` reactivity (task.updated, code.ref, lsp) keeps working alongside the chat connection, and the old chat stack code remains intact for rollback until E2E passes

**Plans**: 5/5 plans executed
Plans:
**Wave 1**

- [x] 05-01-PLAN.md — MockAgui /connect + /stop routes + agui fixture wiring (Wave 0 scaffold for all chat specs; CHAT-01, CHAT-07)
- [x] 05-02-PLAN.md — New chat building blocks: domain tool renderers (shell/file/delegate), DecisionInterrupt card + resume payload mapper, workspaceKey commands path + toToolsMenu (UI-02, CHAT-06, D-04/D-06/D-07)

**Wave 2** *(blocked on Wave 1 completion)*

- [x] 05-03-PLAN.md — RailyinChat tracer: CopilotKitProvider + styles.css + wrapper core + TaskChatView swap + streaming/history/empty/error specs (CHAT-01, CHAT-07, UI-01)

**Wave 3** *(blocked on Wave 2 completion)*

- [x] 05-04-PLAN.md — RailyinChat expansion: canonical tool-call slots, stop + "Stopped" label, reasoning, slash toolsMenu, #interrupt slot + behavior e2e scenarios (CHAT-03, CHAT-04, CHAT-05, CHAT-06, UI-02)

**Wave 4** *(blocked on Wave 3 completion)*

- [x] 05-05-PLAN.md — ChatThreadSidebar + BoardView swap, SessionChatView swap, markdown parity CSS, phase gate (UI-04, IMPR-03, CHAT-02)

**UI hint**: yes

### Phase 6: E2E Migration & Verification

**Goal**: The entire automated test surface — bridge/runner contract tests, the migrated Playwright suite, and backend smoke tests — is green on the new stack before any cleanup
**Mode**: mvp
**Depends on**: Phase 5
**Requirements**: VERF-02, VERF-03
**Success Criteria** (what must be TRUE):

  1. The Playwright E2E suite passes against the mock fixture foundation (SSE/AG-UI events mocked at `/api/copilotkit/*`), starting with one canonical streaming spec then migrating the full suite
  2. All 55 existing specs pass against the new mocks, alongside the new chat and board specs
  3. Backend smoke tests (`e2e/api`) and the bridge/runner unit suites pass on the new stack

**Plans**: TBD

### Phase 7: Cleanup & Feature Trim

**Goal**: The hand-rolled chat stack — protocol, stores, editor, and trimmed features — is deleted now that the swap is proven, with old tables frozen but intact
**Mode**: mvp
**Depends on**: Phase 6
**Requirements**: (PROJECT.md Active trim items — no v1 REQ-IDs: file_diff, code_review, transition_event, status/status_chunk, usage display, compaction_summary, ask_user, shell_approval)
**Success Criteria** (what must be TRUE):

  1. User no longer sees trimmed features anywhere in the app: usage display, status/status_chunk, file_diff, code_review, transition_event, compaction_summary, ask_user, shell_approval
  2. Chat keeps working with zero new writes to the old SQLite chat tables (frozen, not dropped)
  3. `git grep` shows zero references to the custom StreamEvent protocol and deleted modules; build and all suites stay green after deletion
  4. Legacy import is retired behind a flag once imports are complete

**Plans**: TBD

## Coverage

| Phase | Requirements |
|-------|--------------|
| Phase 1 | HOST-01, HOST-02, HOST-03 |
| Phase 2 | BRDG-01, BRDG-02, BRDG-03, RUNR-01, RUNR-02, RUNR-03, RUNR-04, RUNR-05, RUNR-06, RUNR-07 |
| Phase 3 | RUNR-08, CHAT-09, UI-03, VERF-01 |
| Phase 4 | CHAT-08, IMPR-01, IMPR-02 |
| Phase 5 | CHAT-01, CHAT-02, CHAT-03, CHAT-04, CHAT-05, CHAT-06, CHAT-07, UI-01, UI-02, UI-04, IMPR-03 |
| Phase 6 | VERF-02, VERF-03 |
| Phase 7 | (PROJECT.md Active trim items; discharges IMPR-03 rollback window closed by Phase 6) |

**Coverage: 33/33 v1 requirements mapped ✓ — no orphans, no duplicates.**

## Progress

**Execution Order:**
Phases execute in numeric order: 1 → 2 → 3 → 4 → 5 → 6 → 7

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. CopilotRuntime Hosting & Thread APIs (Spike) | 3/3 | Complete    | 2026-08-09 |
| 2. AG-UI Bridge & RailyinAgentRunner | 3/3 | Complete    | 2026-08-09 |
| 3. Decision Interrupts & Resume | 3/3 | Complete    | 2026-08-09 |
| 4. JSONL Persistence & Legacy Import | 3/3 | Complete    | 2026-08-09 |
| 5. Chat UI Replacement (Vue) | 5/5 | Complete    | 2026-08-09 |
| 6. E2E Migration & Verification | 0/TBD | Not started | - |
| 7. Cleanup & Feature Trim | 0/TBD | Not started | - |
