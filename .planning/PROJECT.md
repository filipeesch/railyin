# Railyin — CopilotKit/AG-UI Chat Stack Rework

## What This Is

Railyin is an AI-assisted delivery orchestration tool: a single-process local application that runs a Kanban-style board of task cards, delegates task work to pluggable AI coding agents ("engines" — pi, Claude, Copilot, Cursor, OpenCode), and streams their activity to a Vue 3 frontend. This project replaces Railyin's hand-rolled chat stack (custom streaming protocol, dual-layer conversation store, custom chat UI, SQLite chat storage) with the AG-UI protocol + CopilotKit stack, while keeping the board, cards, decision-request workflow, worktrees, and the engine adapter layer intact.

## Core Value

The board + task card workflow with decision-request UX, powered by pluggable engine adapters, must keep working end-to-end while the chat stack underneath is swapped for AG-UI + CopilotKit.

## Requirements

### Validated

- ✓ Board with columns, WIP limits, config-driven transitions (`tasks.transition`) — existing
- ✓ Task cards with per-task git worktrees (`WorktreeManager`) — existing
- ✓ Decision-request workflow with persisted decision records (`decision_batches/records/revisions`, `task_hunk_decisions`) — existing
- ✓ Notes, todos, line comments per task — existing
- ✓ Five pluggable engine adapters (pi/claude/copilot/cursor/opencode) emitting a normalized `EngineEvent` stream — existing
- ✓ MCP integration with OAuth 2.0 registry + discovery tools — existing
- ✓ Prompt refs (`/prompt-name`), slash commands, stage instructions, cross-engine context, compaction — existing

### Active

- [ ] Adopt AG-UI as the wire protocol between agent backend and frontend, replacing the custom `StreamEvent` protocol
- [ ] Replace the custom chat UI stack with CopilotKit Vue (`CopilotChat` + slots, `CopilotChatInput`), deleting the ~7k-line manual implementation
- [ ] Bridge the engine adapter layer to AG-UI via a custom `RailyinAgentRunner` (run/connect/stop/isRunning), keeping all five engines
- [ ] Store chat history as per-thread JSONL files (`data/threads/{threadId}.jsonl`) via a custom runner (no official JSONL runner in CopilotKit)
- [ ] Map board-card conversations and standalone chat sessions to CopilotKit threads (threadId = conversation.id)
- [ ] Provide a legacy-import button converting old `conversation_messages`/`stream_events` rows into threads; keep old tables intact for rollback (no drops)
- [ ] Keep decision_request as the only human-in-the-loop UX via `on_interrupt` + resume; run pauses instead of ending
- [ ] Replace tool-run rendering with CopilotKit's tool-call slots (default card covers generic tools; ported renderers for shell/file/delegate)
- [ ] Remove features: file_diff, code_review, transition_event, status/status_chunk, usage display, compaction_summary, ask_user, shell_approval
- [ ] Keep board reactivity on `/ws` (task.updated, code.ref, lsp) while chat push moves to the CopilotKit connection
- [ ] Host CopilotRuntime inside Bun.serve (hono handler) without a second server

### Out of Scope

- Dropping old chat tables (`conversation_messages`, `stream_events`, `chat_sessions`) — kept for rollback; only writes stop
- Replacing the workflow/orchestrator/executor layer — no stack equivalent, domain-owned
- Mermaid rendering in chat — acceptable to lose
- Thread sidebar workspace scoping — global thread list is fine for v1
- Long-thread virtualization — full-history replay accepted for v1; revisit if it becomes an issue
- `model_raw_messages` table — engine-internal (resume, compaction), stays
- CopilotKit frontend tools for board tools — board tools stay server-side (DB-bound)
- Voice, suggestions, A2UI/generative UI, MCP Apps — optional future additions, not v1

## Context

- Brownfield migration on a dedicated git worktree `railyin-tree` (branch `copilotkit`), main repo untouched; rollback = switch branches.
- The current chat stack is ~8,200 lines of custom code (protocol, stores, UI) plus three chat tables; target adds ~800–1,000 lines (bridge/runner/import).
- CopilotKit Vue SDK is early-access (June 2026); pin exact versions and wrap usage in thin local components.
- No official JSONL runner exists in CopilotKit; custom runner extends `InMemoryAgentRunner` (documented extension pattern), ~150 L persistence + ~250 L bridge.
- `@copilotkit/runtime` v2 exports hono/express/node handlers; hono chosen for Bun.serve integration.
- `useThreads` on self-hosted runtime is a risk — fallback is our own thread-index list endpoint (we own the files).
- Claude double-broadcast avoidance (`markClaudeExecution`) disappears — single translation path in the bridge.
- E2E suite (55 Playwright specs) currently hand-mocks the custom protocol; must be reworked to mock `/api/copilotkit/*`.

## Constraints

- **Tech stack**: Vue 3 + Bun single-process app; no new servers, no external services (local-first)
- **Engine compatibility**: all five engine SDK adapters must remain; AG-UI is only the wire boundary
- **Storage**: chat history as JSONL files per thread (user preference); SQLite retains only non-chat state
- **Rollback**: existing chat tables frozen, not dropped
- **Dependencies**: `@copilotkit/vue` + `@copilotkit/runtime` v2 + `@ag-ui/core` pinned versions

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| AG-UI as wire protocol + CopilotKit for UI/runtime/storage | Railyin's custom protocol is a home-grown AG-UI subset; standardize instead of maintaining | — Pending |
| Custom `RailyinAgentRunner` with JSONL persistence | User prefers file-based chat storage; no official JSONL runner; runner interface is the documented extension point | — Pending |
| Keep old SQLite chat tables (no drops) | Rollback safety for a personal tool | — Pending |
| Full `CopilotChat` + slots adoption (not hybrid) | User chose maximal simplification; custom renderers ported into slots | — Pending |
| Adopt `CopilotChatInput` | Drop CodeMirror chat editor; slash commands via tools menu | — Pending |
| decision_request is the only HITL | ask_user/shell_approval removed; decision UX kept and upgraded to interrupt/resume | — Pending |
| Remove file_diff/code_review/transition_event/status/usage/compaction_summary | Feature trim; code review executor + FileStateCache + shell gate deleted | — Pending |
| Thread = conversation (threadId = conversation.id); sessions = threads without taskId | Unified thread model for cards and standalone chat | — Pending |
| Legacy-import button, not automatic migration | On-demand conversion; tables retained until imported | — Pending |
| CopilotRuntime mounted in Bun.serve via hono handler | Single server, no port juggling | — Pending |
| Board `/ws` stays for task.updated/code.ref/lsp; chat moves to CopilotKit connection | Board reactivity unchanged | — Pending |
| Mermaid, workspace-scoped sidebar, long-thread virtualization deferred | Accepted trade-offs for v1 | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-08-08 after initialization*
