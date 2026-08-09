---
phase: 06-e2e-migration-verification
plan: phase-summary
subsystem: testing
tags: [playwright, mock-agui, ag-ui, copilotkit, e2e-migration, retire, gate, verification]

# Dependency graph
requires:
  - phase: 05-chat-ui-replacement-vue
    provides: RailyinChat.vue new DOM (data-testids), DecisionInterrupt.vue, mock-agui fixture + /run /connect /stop /info scripts, chat-copilotkit.spec.ts canonical template
provides:
  - "D-05 full-suite gate evidence: build + 42-file Playwright suite (517 pass / 8 intentional skips / 0 fail / 0 did-not-run) + e2e/api 82 + src/bun 2396 + typecheck + mock-agui 23 — the provably-green stack Phase 7 cleanup runs against"
  - "API-coverage decision record (06-COVERAGE.md): detector {'detected':false,'signals':[]} — zero packages/keys/hosts, all traffic mocked, e2e/api the single real-server layer"
  - "Complete retire/migrate audit trail: 11 whole-file retires (~113 tests) + ~79 in-file retires by file with rationale; 13 files migrated onto the mock foundation; 06-VALIDATION.md closed (nyquist_compliant: true)"
affects: [07-cleanup, verify-work, gsd-ship, IMPR-03 rollback window]

# Metrics
duration: 6 phases
completed: 2026-08-09
status: complete
---

# Phase 6: E2E Migration & Verification Summary

**The entire automated test surface is green on the new AG-UI/CopilotKit stack: the 25-file red surface is reduced to ZERO via 11 whole-file spec retires + 13 file migrations onto the MockAgui fixture foundation, and the D-05 final gate passes end-to-end (build + 42-file Playwright suite + backend smoke + bridge/runner units + typecheck + fixture self-tests) with recorded evidence — closing the phase with the API-coverage decision and the validation contract signed off.**

## Performance

- **Started:** 2026-08-09 (wave 1 — retire-first)
- **Completed:** 2026-08-09 (wave 3 — D-05 gate + close-out)
- **Plans:** 7 (06-01 fixture extension + tracer, 06-02 retires, 06-03..06-06 migration wave, 06-07 gate + close-out)
- **Spec files on disk:** 53 at phase start (A1: ROADMAP "55" = count drift) → 42 after the 11 whole-file retires → all 42 green in the final gate

## D-05 Gate Evidence (06-07 Task 1, 2026-08-09)

Pre-gate hygiene: `rm -rf test-results playwright-report` executed before the final gate run so the gate artifacts reflect the green run (RESEARCH Runtime State Inventory). Regression tripwire first, then the ordered six-leg sequence per RESEARCH Pattern 4:

| Leg | Command | Result | Evidence |
|-----|---------|--------|----------|
| Tripwire | `bunx playwright test e2e/ui/chat-copilotkit.spec.ts e2e/ui/board.spec.ts e2e/ui/board-ws-updates.spec.ts` | ✅ 56/56 passed (14.1s) | canonical + board sets never disturbed |
| 1 | `bun run build` | ✅ built in 19.09s | dist/ rebuilt by the gate itself |
| 2 | `bunx playwright test e2e/ui` | ✅ **517 passed / 8 skipped / 0 failed / 0 did-not-run** (1.7m, 42 spec files) | zero failures, zero did-not-run |
| 3 | `bun test e2e/api --timeout 30000` | ✅ **82 pass / 0 fail** (111.63s) | backend smoke on the new stack |
| 4 | `bun test src/bun --timeout 20000` | ✅ **2396 pass / 2 skip / 0 fail** (58.98s) | D-06 bridge/runner suites stay green |
| 5 | `bun run typecheck` | ✅ clean (exit 0) | tsc --noEmit |
| 6 | `bun test e2e/ui/fixtures/mock-agui.test.ts` | ✅ **23 pass / 0 fail** (177ms) | extended fixture self-tests |

**Skip reconciliation (both intentional, pre-existing):** the 8 Playwright skips are interview-me's A6-gap tests (fixture interrupt payload is exclusive-only — recorded in 06-05, resolution deferred to the phase-gate reviewer); stream-reactivity's conditional autoscroll `test.skip()` guards did NOT fire in this run. The 2 src/bun skips are the planning-time baseline (2396 pass / 2 skip since RESEARCH).

All six legs ran in the single chained command per T-06-27 mitigation — no leg skippable by instruction. **Gate verdict: GREEN.**

## Retire Rationale (11 whole-file + in-file, recorded per Pitfall 7)

Every retire was approved at 06-02 blocking human checkpoints with live re-verified Pattern-2 grep proof (selector exists ONLY in dead legacy components; no live importer). ~113 whole-file + ~79 in-file ≈ **192 tests retired** with rationale-bearing commits.

### Whole-file retires (11 files, ~113 tests — 06-02, commits f843de9a + 41ddb5ea)

| File | Tests | Subject → fate |
|------|-------|----------------|
| queue-messages.spec.ts | 25 | Queue UI + drain → removed (UI-SPEC:140 "no queue affordance"); queue-btn/queue-chips only in dead ConversationInput.vue |
| model-persistence.spec.ts | 10 | In-chat model selector persistence → removed (.input-model-select only at ConversationInput.vue:175) |
| reasoning-mode-select.spec.ts | 4 | Per-model reasoning-effort selector → removed; thinkingFormat now engines.yaml config; CHAT-05 covered by chat-copilotkit C-2 |
| sampling-preset-select.spec.ts | 10 | Preset selector → removed; presets now per-model in engines.yaml (AGENTS.md) |
| model-picker-multi-engine.spec.ts | 5 | Engine-grouped model picker → removed with the legacy input; ManageModelsModal is a different surface |
| attachment-history.spec.ts | 3 | [#ref\|label] file-chip rendering → removed (CONT-01 attachments out of scope) |
| mcp-tools.spec.ts | 34 | MCP server popover UI → removed; MCP tool calls covered by default-card T-1 pattern |
| conversation-pagination.spec.ts | 10 | Load-older sentinel pagination → removed; full-history replay is v1 (PERF-01 deferred) |
| compact-button.spec.ts | 3 | Context ring + manual compact → removed (compaction_summary in trim list) |
| transition-card-legacy.spec.ts | 2 | .msg--prompt / transition_event conversation rendering → removed (trim list) |
| conversation-draft.spec.ts | 7 | CodeMirror draft persistence → removed (no draft/initialValue props in CopilotChatInput.vue.d.ts — verified) |

### In-file retires by file (~79 tests)

| File | Tests | Subject → fate |
|------|-------|----------------|
| code-server.spec.ts | 5 (CS-D-1..5) | CodeRef chips in the input area (.attachment-chip .ln__* only in dead ConversationInput.vue) |
| chat.spec.ts | 1 (N-9 queue half) | Queue-enabled drain assertion — queue UI removed |
| conversation-body.spec.ts | 2 (CB-2, CB-4) | Virtualization (PERF-01 deferred, full replay is v1) + transition cards (trim) |
| tool-rendering.spec.ts | 3 (S-28, top-level S-29, S-30) | Long-line horizontal scroll / read-family / lsp_rename — not in the frozen toolcall fixture payload (no hand-rolled frames, T-06-18) |
| stream-reactivity.spec.ts | 2 (B-2, F-2) | data-stream-version + status_chunk (trimmed features) |
| timeline-pipeline.spec.ts | 14 (T-34/36 + 12 legacy mechanics) | status_chunk (trim) + legacy stream-pipeline mechanics (executionId state machines, .rb pulse lifecycle, virtualized ordering/nesting) — each intent mapped to canonical coverage |
| chat-session-drawer.spec.ts | 9 (A-6, G-1..3, H-2, D-6, K-1/K-2, C-6) | In-session model selector (removed), submitDecisions RPC flow (covered by C-4 resume payload), file chips (removed), status_chunk dedup (trim) |
| autocomplete.spec.ts | 22 (AC-4..9, 13..15, 17..20, 23, 24, 26..28, 31..34) | CodeMirror chips (#/@/LSP) + attachments (removed) |
| cursor.spec.ts | 2 (CU-1.1/1.2) | Model picker (removed with the legacy input) |
| task-drawer.spec.ts | 3 (TD-2, TD-3, TD-7) | Toolbar chrome, attachment chip, transition cards (removed/trim) |
| extended-chat.spec.ts | 16 (P-15, Q-16..20, R-20..25+23, S-1..3) | Compact popover, model selector, compaction (trim), legacy decision_request_prompt ws flow (covered by canonical C-4/C-5) |

## Migration Delta (13 files, VERF-02)

All 13 files migrated onto the mock foundation (api + agui fixtures, `/api/copilotkit/*` via page.route), each green ALONE before its tripwire (Pitfall 4), canonical spec chat-copilotkit frozen throughout (Pitfall 8):

| File | Result | Plan | Commit(s) |
|------|--------|------|-----------|
| conversation-stream-state.spec.ts | 3/3 | 06-01 (tracer) | 1b94288b |
| chat.spec.ts | 12/12 | 06-03 | 214ef6cf |
| delegate-rendering.spec.ts | 5/5 (serial mode dropped) | 06-03 | d14db5b2 |
| conversation-body.spec.ts | 3/3 | 06-03 | 626d2b24 |
| tool-rendering.spec.ts | 13/13 | 06-04 | 63d8f94f |
| stream-reactivity.spec.ts | 17/17 | 06-04 | e37e056b |
| timeline-pipeline.spec.ts | 7/7 | 06-04 | 09e0b0bf |
| chat-session-drawer.spec.ts | 36/36 | 06-05 | 16a1d3a4 |
| interview-me.spec.ts | 21 pass / 8 skip | 06-05 | d05557d3 |
| autocomplete.spec.ts | 12/12 | 06-06 | f0d5d410 |
| cursor.spec.ts | 5/5 | 06-06 | 82ce1805 |
| task-drawer.spec.ts | 7/7 | 06-06 | 82ce1805 |
| extended-chat.spec.ts | 3/3 | 06-06 | c4a3931d |

**Helper/knob additions (fixture layer, append-only — Pitfall 3 held):**
- `MockAgui.historyMessages` knob + `registerHistory(threadId, messages)` per-instance registry (06-01) — multi-message history replay, backward-compatible; self-tested (mock-agui.test.ts 19 → 23)
- Shared chat helpers `chatTextarea` / `submitChatMessage` / `collectConnectRequests` extracted verbatim into fixtures/helpers.ts (06-01); six legacy helpers byte-identical
- Inline session-scoped helpers `chatTextareaSession` / `submitChatMessageSession` (06-05) + shared `expectResumeRan` resume-payload assertion helper (06-05)

## Assumption Deltas That Fired

| # | Delta | Resolution |
|---|-------|------------|
| A1 | ROADMAP "55 existing specs" vs 53 spec files on disk (count drift) | **CONFIRMED.** Gate interpreted as "all spec files green": 53 at start → 42 after the 11 whole-file retires → all 42 green in the D-05 gate run. |
| A6 | Interview decision-card surface gaps | **FIRED (partial).** DecisionInterrupt has NO renderer gap (all four question-type surfaces verified at DecisionInterrupt.vue:37-122), but mock-agui's interrupt payload serves exclusive questions only — 8 interview-me tests (T-B/T-C/T-Q families: non_exclusive/freetext/Other) skipped-with-gap-note. Resolution (an interrupt-payload fixture knob mirroring the 06-01 historyMessages precedent) is a phase-gate reviewer decision, deferred — the 8 skips stay visible in the Playwright report (they cannot silently vanish). |
| Open Question 3 | Test-ID scheme for migrated specs | **RESOLVED — mixed scheme.** Canonical new-stack pattern letters for migrated idioms (S-1/S-2 streaming+history, C-1 stop, C-2 reasoning, C-3 slash, C-4/C-5 interrupt, T-1/T-2/T-3 tool cards — per the chat-copilotkit template) + retained legacy-style per-file IDs where intents map 1:1 (MSG-1, TD-5/6, AC-n, P-12/13/14, CU-n, CD-*), each with an intent-preserving comment. |

## API Coverage Decision (plan:pre contribution — 06-COVERAGE.md)

Detector re-run at close-out (06-07 Task 2): `node <gsd-core>/bin/lib/api-coverage.cjs --json 06-RESEARCH.md 06-CONTEXT.md` → **`{"detected":false,"signals":[]}`** (full JSON incl. terms recorded verbatim in 06-COVERAGE.md). Declaration: **No external API integration** — zero packages added, zero API keys, zero external hosts; all UI traffic mocked via page.route; `e2e/api` is the single real-server layer. Coverage matrix not required; gate closed with the reasoned declaration.

## Validation Contract

- 06-VALIDATION.md **closed** (`nyquist_compliant: true`, `status: closed`, `wave_0_complete: true`): per-task verification map all green (retire grep checks, migrated-file runs, full-suite gate), Wave 0 requirements complete, both retire batches human-approved, sign-off checklist complete — **Approval: Approved 2026-08-09**.
- Phase success criteria: (1) Playwright passes against the mock foundation ✅ (2) all existing specs green alongside new chat/board specs ✅ (3) backend smoke + bridge/runner suites green on the new stack ✅.

## Next Phase Readiness (Phase 7 — Cleanup)

- **Red surface ZERO**: the D-05 gate is green end-to-end with recorded evidence — Phase 7 (old chat stack deletion + feature trim + import retirement) can proceed against a provably green stack; the IMPR-03 rollback window closes (old code survives until the swap passes E2E — it has).
- Phase 7 scope inputs: the retired-feature list doubles as the trim checklist (queue, model selectors, compaction, transition cards, CodeMirror chips, draft UI, load-older, MCP popover — all dead-component-verified); legacy components (ConversationInput/ConversationBody/ChatEditor/MessageBubble/etc.) remain only in dead islands with no live importer.
- Pending for the phase-gate reviewer: the A6 interrupt-payload fixture knob decision (lift the 8 interview-me skips or accept renderer-unit-tested coverage).
- No blockers; canonical spec + fixtures untouched and green; 42 spec files, all green.

---
*Phase: 06-e2e-migration-verification*
*Completed: 2026-08-09*
