# Requirements: Railyin — CopilotKit/AG-UI Chat Stack Rework

**Defined:** 2026-08-08
**Core Value:** The board + task card workflow with decision-request UX, powered by pluggable engine adapters, must keep working end-to-end while the chat stack underneath is swapped for AG-UI + CopilotKit.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases.

### Chat & Protocol (CHAT)

- [ ] **CHAT-01**: User sees agent responses stream token-by-token in the board chat (AG-UI text events, no custom StreamEvent protocol)
- [ ] **CHAT-02**: User sees markdown + code blocks rendered with stable layout, at parity with the old editor for coding output
- [ ] **CHAT-03**: User sees every tool call as an expandable card with name, status, args, and result
- [ ] **CHAT-04**: User can stop/cancel a running agent response; the stop propagates to the engine (best-effort) and the partial response is labeled
- [ ] **CHAT-05**: User sees agent reasoning/thinking display (zero-config reasoning card, pi thinking routed through)
- [ ] **CHAT-06**: User can use slash commands and `/prompt-name` refs with parity (ref must be the entire leading value)
- [ ] **CHAT-07**: User can reopen a card or session and see its full conversation history, including across app restarts
- [ ] **CHAT-08**: User can list and navigate thread conversations via Railyin's own thread-index endpoint (self-hosted; `useThreads` not usable)
- [ ] **CHAT-09**: User can approve/reject a decision request as structured cards; the agent run genuinely pauses and resumes with the decision payload

### Runner & Persistence (RUNR)

- [x] **RUNR-01**: `RailyinAgentRunner` bridges all five engines (pi/claude/copilot/cursor/opencode) behind one AG-UI boundary, with per-workspace engine selection intact
- [x] **RUNR-02**: Conversations persist per-thread as JSONL (`data/threads/{threadId}.jsonl`) via the custom runner
- [x] **RUNR-03**: Thread mapping holds: `threadId = conversation.id` for cards; standalone sessions are threads without a taskId
- [x] **RUNR-04**: Runner enforces run locking — concurrent runs on the same thread are rejected with a clear error
- [x] **RUNR-05**: Reconnect/reload replays the full conversation from the JSONL event log (not snapshots)
- [x] **RUNR-06**: connect-before-run returns a valid empty conversation snapshot for unknown threads
- [x] **RUNR-07**: Replayed tool calls synthesize `TOOL_CALL_RESULT` events so cards never show stale "running" state
- [ ] **RUNR-08**: Runner emits `RUN_FINISHED` with `outcome: interrupt` + `RunAgentInput.resume[]` entries for decision requests (canonical AG-UI contract; not the deprecated `on_interrupt` event)

### Runtime & Hosting (HOST)

- [x] **HOST-01**: CopilotRuntime is mounted inside the existing Bun.serve server (single origin, self-hosted, no extra server process)
- [x] **HOST-02**: Long SSE streams survive extended agent silences (Bun `idleTimeout` tuned; no mid-stream kills)
- [x] **HOST-03**: Runtime handler choice (fetch-native vs hono) is resolved with evidence and matches the pinned stack

### Bridge (BRDG)

- [x] **BRDG-01**: Engine `EngineEvent` deltas (text, reasoning, tool calls, interrupt) map to AG-UI events through exactly one translation path (no double-broadcast)
- [x] **BRDG-02**: Engine thinking routes to `REASONING_*` events consumed by the reasoning card
- [x] **BRDG-03**: Tool calls emit the complete lifecycle (`TOOL_CALL_START`/`ARGS`/`END`/`RESULT`) so renderers and replay stay consistent

### Import & Migration (IMPR)

- [ ] **IMPR-01**: User can trigger a legacy import button that converts old `conversation_messages`/`stream_events` rows into JSONL threads
- [ ] **IMPR-02**: Old chat tables are frozen, not dropped; import is on-demand and idempotent
- [ ] **IMPR-03**: Rollback is possible until the swap is proven — old chat stack code stays alive until the UI swap phase passes E2E

### Chat UI (UI)

- [ ] **UI-01**: Board chat UI is replaced with CopilotKit components (input, messages, streaming) preserving the existing board layout and conversation store contract for live stream blocks
- [ ] **UI-02**: Domain tool renderers exist for shell output, file changes, and delegate task summaries (not raw JSON cards)
- [ ] **UI-03**: Decision-request UX renders as interrupt cards with structured approve/reject and payload
- [ ] **UI-04**: Board `/ws` reactivity (task.updated, code.ref, lsp) keeps working alongside the chat connection

### Verification (VERF)

- [ ] **VERF-01**: Bridge + runner have unit tests with a fake engine (contract tests for events, interrupts, replay)
- [ ] **VERF-02**: Playwright E2E suite is migrated onto the new mock fixture foundation (SSE/CopilotKit events mocked) and passes
- [ ] **VERF-03**: Backend smoke tests and the 55 existing UI specs are green on the new stack before cleanup

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Chat

- **CHAT-10**: User can regenerate/retry a response (verify Vue v2 API first; else JSONL replay + re-run fallback)
- **CHAT-11**: Cancel hardening — per-engine abort verification; partial responses labeled "stopped"
- **CHAT-12**: Suggestions (contextual prompts) via `useConfigureSuggestions`
- **CHAT-13**: Thread list niceties (rename/archive/delete via own index endpoint)

### Content & Input

- **CONT-01**: Attachments (images/context blobs) via `attachments` prop + local upload endpoint
- **CONT-02**: Mermaid rendering in chat messages

### Generative UI

- **GEN-01**: A2UI generative UI (decision forms, structured input beyond cards)
- **GEN-02**: MCP Apps (interactive MCP tool UIs via `@ag-ui/mcp-apps-middleware`)

### Performance

- **PERF-01**: Long-thread virtualization (full-history replay accepted for v1)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Frontend tools (`useFrontendTool`) | Split execution model (board tools are DB-bound on the server); state-sync hazards with no benefit for a single-user app — architectural non-goal |
| Realtime multi-client thread sync (`useThreads` WebSockets) | Premium infra for multi-client consistency; one user, one tab; local state + own thread-index endpoint instead — non-goal |
| Shared state streaming (`StateStreamingMiddleware`) | Targets collaborative-doc surface Railyin doesn't have; `/ws` board events already stream live state — non-goal |
| Voice input | Desk-bound power tool; mic permission + transcription UI for ~zero daily use |
| A2UI / generative UI in v1 | Component schema registry + renderer + persistence infra; decision cards + tool slots cover 95% of real needs |
| MCP Apps in v1 | Iframe sandbox infra + middleware + env-staleness persistence gotchas; scope creep in a migration |
| Attachments in v1 | Engines already have filesystem access to the worktree — redundant for the primary use case |
| Rebuilding trimmed features (usage display, compaction_summary, status/status_chunk, file_diff, code_review, transition_event) | Deliberate feature trim; custom protocol types with no AG-UI equivalent vs maintenance cost |
| Mermaid rendering | CopilotKit default renderer doesn't do it; custom renderer + sanitizer for a rare case (v2) |

## Traceability

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| CHAT-01 | Phase 5 | Pending |
| CHAT-02 | Phase 5 | Pending |
| CHAT-03 | Phase 5 | Pending |
| CHAT-04 | Phase 5 | Pending |
| CHAT-05 | Phase 5 | Pending |
| CHAT-06 | Phase 5 | Pending |
| CHAT-07 | Phase 5 | Pending |
| CHAT-08 | Phase 4 | Pending |
| CHAT-09 | Phase 3 | Pending |
| RUNR-01 | Phase 2 | Complete |
| RUNR-02 | Phase 2 | Complete |
| RUNR-03 | Phase 2 | Complete |
| RUNR-04 | Phase 2 | Complete |
| RUNR-05 | Phase 2 | Complete |
| RUNR-06 | Phase 2 | Complete |
| RUNR-07 | Phase 2 | Complete |
| RUNR-08 | Phase 3 | Pending |
| HOST-01 | Phase 1 | Complete |
| HOST-02 | Phase 1 | Complete |
| HOST-03 | Phase 1 | Complete |
| BRDG-01 | Phase 2 | Complete |
| BRDG-02 | Phase 2 | Complete |
| BRDG-03 | Phase 2 | Complete |
| IMPR-01 | Phase 4 | Pending |
| IMPR-02 | Phase 4 | Pending |
| IMPR-03 | Phase 5 | Pending |
| UI-01 | Phase 5 | Pending |
| UI-02 | Phase 5 | Pending |
| UI-03 | Phase 3 | Pending |
| UI-04 | Phase 5 | Pending |
| VERF-01 | Phase 3 | Pending |
| VERF-02 | Phase 6 | Pending |
| VERF-03 | Phase 6 | Pending |

**Coverage:**

- v1 requirements: 33 total
- Mapped to phases: 33
- Unmapped: 0 ✓

---
*Requirements defined: 2026-08-08*
*Last updated: 2026-08-08 after roadmap creation*
