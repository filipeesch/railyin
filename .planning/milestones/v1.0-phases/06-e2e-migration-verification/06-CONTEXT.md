# Phase 6: E2E Migration & Verification - Context

**Gathered:** 2026-08-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase migrates the Playwright E2E suite onto the new mock fixture foundation (AG-UI/SSE events mocked at `/api/copilotkit/*`) so the entire automated test surface — migrated UI specs, new chat/board specs, bridge/runner contract tests, and backend smoke tests — is green on the new stack before any cleanup. It migrates the expected-red legacy chat-surface specs (Phase 5 swap broke their selectors by design) and verifies the full suite against the new mocks. Deliberately NOT in scope: deleting the old chat stack (Phase 7), feature trim (Phase 7), UI work (Phase 5 done).

</domain>

<decisions>
## Implementation Decisions

### Migration Scope & Strategy (VERF-02)
- **D-01:** Migrate the expected-red legacy chat-surface specs (chat.spec.ts, chat-session-drawer, queue-messages, model-persistence, reasoning-mode-select, extended-chat, delegate-rendering, conversation-body, attachment-history, autocomplete) onto the new selectors/mocks — their old assertions target swapped-out legacy DOM (`.msg--user`, `.msg__bubble.streaming`, CodeMirror `.cm-content`, send-btn/queue-btn). Each migrated spec keeps its test intent but asserts against the new RailyinChat DOM + mock-agui fixtures.
- **D-02:** Migration is incremental, spec-by-spec: each migrated spec must pass against the mock foundation (mock-api + mock-agui, `/api/copilotkit/*` via page.route). The full suite must be green at the end (success criterion 2: all existing specs + new chat/board specs).
- **D-03:** Board-focused specs that never touched chat (board.spec, board-dnd, board-ws-updates, board-* family, code-server, worktree, etc.) are already green (verified in Phase 5) — they stay untouched; the migration focuses on chat-adjacent specs.

### Mock Foundation (VERF-02 foundation)
- **D-04:** The mock foundation from Phase 1/5 (mock-api.ts + mock-agui.ts with /run, /connect, /stop, /info) is THE source of truth for migrated specs — no new real-server paths in UI specs (AGENTS.md discipline). Extend mock-agui with script variants as needed for migrated scenarios.

### Verification Gate (VERF-03)
- **D-05:** The full gate at the end: `bun run build` + full Playwright suite (all specs) + `bun test e2e/api --timeout 30000` + `bun test src/bun --timeout 20000` + `bun run typecheck` — all green on the new stack (success criteria 2+3).
- **D-06:** Bridge/runner contract suites (src/bun/copilotkit + execution-seam) stay green throughout (they're stack-core, already green).

### the agent's Discretion
- Exact migration ordering (which specs first) — planner picks by dependency/size.
- Whether migrated specs reuse the old test IDs (lettered M/N/O) or get new ones.
- Whether any legacy spec is retired rather than migrated (e.g., if it tests a removed feature) — must be recorded with rationale.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research (produced this project)
- `.planning/research/FEATURES.md` — anti-features (what was deliberately removed — specs testing removed features may retire).
- `.planning/research/PITFALLS.md` lines 285-300 — mock fixture family (mock-runtime + mock-agui) guidance.
- `.planning/research/SUMMARY.md` — Phase 6 = "E2E Migration & Verification" (fixture foundation built in Phase 1, 55 specs migrated onto it).

### Project documents
- `.planning/PROJECT.md` — E2E suite migration scope, mock foundation.
- `.planning/REQUIREMENTS.md` — VERF-02, VERF-03 (this phase).
- `.planning/ROADMAP.md` §Phase 6 — 3 success criteria.

### Codebase (integration points)
- `e2e/ui/fixtures/mock-api.ts` — typed ApiMock (501 for unhandled; route.fallback).
- `e2e/ui/fixtures/mock-agui.ts` — AG-UI SSE mock (/run, /connect, /stop, /info; EventEncoder framing).
- `e2e/ui/fixtures/index.ts` — auto-use fixtures (ws, api, agui).
- `e2e/ui/*.spec.ts` — the 53 specs; the expected-red chat-surface ones are the migration targets.
- `src/mainview/components/chat/RailyinChat.vue` — new chat DOM (data-testids: chat-input, stop-btn, chat-stopped, thread-*, decision-card, tool-call-*).
- `.planning/phases/05-chat-ui-replacement-vue/05-SUMMARY.md` — what Phase 5 shipped (new selectors, mock-agui extensions).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- mock-api.ts (typed, 501-loud) + mock-agui.ts (validated byte-identical SSE, /connect+/stop added in Phase 5) + auto-use fixtures.
- Phase 5 chat-copilotkit.spec.ts — the canonical new-suite spec (16 scenarios) as the migration template.
- board-ws-updates.spec.ts + board.spec.ts — green regression sets proving /ws + layout (UI-04).

### Established Patterns
- UI specs mock ALL backend via page.route; never a real Bun server (AGENTS.md).
- Data-testid conventions from UI-SPEC.
- `bun run test:e2e` (build + full suite) / `bun run test:e2e:chat` (chat specs).

### Integration Points
- e2e/ui/fixtures/ — extension point for any new script variants needed by migrated specs.
- The expected-red spec list (chat.spec 12, chat-session-drawer 26, queue-messages 25, model-persistence 10, reasoning-mode-select 3, extended-chat, delegate-rendering, conversation-body, attachment-history, autocomplete) — the migration targets.

</code_context>

<specifics>
## Specific Ideas

- Success criterion 1: "starting with one canonical streaming spec then migrating the full suite" — chat-copilotkit.spec.ts IS the canonical streaming spec (Phase 5); migration extends from it.
- Success criterion 2: "All 55 existing specs pass against the new mocks, alongside the new chat and board specs" — the full-suite green gate.
- Success criterion 3: backend smoke + bridge/runner suites green on the new stack.

</specifics>

<deferred>
## Deferred Ideas

- Old chat stack deletion + feature trim + import retirement — Phase 7.
- New feature specs beyond migration (regenerate, suggestions) — v2.

</deferred>

---

*Phase: 6-E2E Migration & Verification*
*Context gathered: 2026-08-09*
