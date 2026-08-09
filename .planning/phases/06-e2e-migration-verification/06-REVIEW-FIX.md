---
phase: 06
fixed_at: 2026-08-09T15:44:34Z
review_path: .planning/phases/06-e2e-migration-verification/06-REVIEW.md
iteration: 1
findings_in_scope: 10
fixed: 10
skipped: 0
status: all_fixed
---

# Phase 6: Code Review Fix Report

**Fixed at:** 2026-08-09T15:44:34Z
**Source review:** `.planning/phases/06-e2e-migration-verification/06-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 10 (6 warnings, 4 infos — all fixed; the infos were trivial per the fix instructions)
- Fixed: 10
- Skipped: 0

## Fixed Issues

### WR-01: Connect replay framing diverges from the real runner — the "never drift" claim overstates

**Files modified:** `e2e/ui/fixtures/mock-agui.ts`, `e2e/api/copilotkit/sse-text-diff.test.ts`
**Commits:** `c57e6f3a`
**Applied fix:**
- (a) Reworded the header: the byte-parity claim is now explicitly scoped to the `/run` path (D-07), and the connect replay is documented as a **deliberate divergence** — the real in-memory runner replays compacted historic events only and never emits `MESSAGES_SNAPSHOT`; the fixture's synthetic snapshot is documented as a client-contract convenience whose id-based replace semantics make the rendered final state equivalent to the real replay's reconstruction.
- (b) Added two real-server connect-parity tests to `sse-text-diff.test.ts` (probe server):
  1. **never-run connect**: fixture empty body is byte-identical to the real runner's empty connect body (RUNR-06) + shared headers.
  2. **registered-thread connect**: asserts the shared client-contract invariants on BOTH sides — first frame `RUN_STARTED`, single terminal `RUN_FINISHED` last, real replay contains NO `MESSAGES_SNAPSHOT` — and pins the fixture's deliberate framing (one snapshot strictly before the single terminal, carrying the replayed `m1` message). Verified against the actual `in-memory.mjs` `connect()` source (compacted `historicRuns` replay) and `compactEvents` semantics before writing.

### WR-02: Negative `agui.runInputs` assertions are false-negative capable

**Files modified:** `e2e/ui/chat.spec.ts` (N-8), `e2e/ui/chat-session-drawer.spec.ts` (CD-B-2, CD-B-3), `e2e/ui/autocomplete.spec.ts` (AC-10)
**Commit:** `87a43d62`
**Applied fix:** Bound the negative window deterministically per the review's pattern — `await page.waitForTimeout(500)` after the key press so any (buggy) submit has time to reach the fixture's route handler, then assert `agui.runInputs` has length 0. N-8's immediate-pass poll (`expect.poll(...).toBe(0)`) was replaced with the bounded window.

### WR-03: B-1 MutationObserver attach races the empty-state render

**File:** `e2e/ui/stream-reactivity.spec.ts` (B-1)
**Commit:** `93a91e8d`
**Applied fix:** Replaced the fixed `waitForTimeout(200)` with a deterministic settle: `await expect(page.locator('[data-testid="chat-empty-state"]')).toBeVisible({ timeout: 10_000 })` — the empty state is the settled render for a never-run thread, so the observer can never count a late initial render as a mutation.

### WR-04: Call-state assertions gated by `waitForTimeout(300)` instead of polling

**File:** `e2e/ui/chat-session-drawer.spec.ts` (CD-D-5, CD-I-1)
**Commit:** `768f54c1`
**Applied fix:** CD-D-5 now polls `await expect.poll(() => renameCalled, { timeout: 3_000 }).toBe(true)`. CD-I-1's negative assertion now uses the bounded 500ms negative window. (CD-I-2's `waitForTimeout(300)` left as-is — the review marked it acceptable because its follow-up assertions poll.)

### WR-05: Scroll assertions use single-shot evaluates / fixed settle windows instead of `expect.poll`

**Files modified:** `e2e/ui/chat-session-drawer.spec.ts` (CD-E-4), `e2e/ui/stream-reactivity.spec.ts` (E-3, E-4, E-5, E-6)
**Commits:** `59a16d01`, `f9d13b0e` (follow-up)
**Applied fix:** Converted all five fixed-settle/one-shot scroll assertions to `expect.poll` (the E-1/E-7 pattern): CD-E-4 polls the `isAtBottom` predicate; E-3/E-4/E-6 poll `distFromBottom(scroll)` against their thresholds; E-5 polls `|scrollTop − baseline| ≤ 5`. **Follow-up commit `f9d13b0e`:** the E-5 poll initially referenced the Node-side `scrollTopBefore` inside `locator.evaluate`, which is not serializable into the browser context — the value is now passed as the evaluate `arg` (`(el, baseline) => ...`). This was caught by the spec run and fixed before final verification.

### WR-06: `startCalled` / `stopCalled` booleans asserted before the route handler can run

**File:** `e2e/ui/code-server.spec.ts` (CS-B-1, CS-B-5)
**Commit:** `d7b234b0`
**Applied fix:** Both assertions converted to `await expect.poll(() => startCalled|stopCalled, { timeout: 3_000 }).toBe(true)` — the overlay renders while the request is in flight, ahead of Playwright's route dispatch.

### IN-01: Dead helper exports (`sendMessage`, `typeInSessionEditor`)

**Files modified:** `e2e/ui/fixtures/helpers.ts`, `e2e/ui/fixtures/index.ts`
**Commit:** `1ac93ad8`
**Applied fix:** Removed both helpers (legacy CodeMirror `.cm-content` selectors) and dropped them from the index re-export; verified zero remaining callers in `e2e/`.

### IN-02: Direct `agui.stopRequests` assertion after the Stopped marker

**Files modified:** `e2e/ui/chat.spec.ts` (N-6), `e2e/ui/chat-session-drawer.spec.ts` (CD-C-4, CD-J-1), `e2e/ui/extended-chat.spec.ts` (P-12, P-13)
**Commit:** `b2595f11`
**Applied fix:** All five direct assertions converted to `await expect.poll(() => agui.stopRequests.includes(String(threadId)), { timeout: 3_000 }).toBe(true)` per the review's snippet. The frozen canonical `chat-copilotkit.spec.ts` keeps its inline copy untouched (documented convention — Pitfall 8).

### IN-03: Module-level mutable message-id counter

**File:** `e2e/ui/interview-me.spec.ts`
**Commit:** `e4c39330`
**Applied fix:** Removed the module-level `let _msgId = 5000`; `makeInterviewPrompt` now requires an explicit literal id in `overrides` (compile-time enforced via `Partial<ConversationMessage> & { id: number }`). The two consumers pass `{ id: 6001 }` (T-F) and `{ id: 6002 }` (T-G); both still pin the reply to `promptMsg.id + 1`.

### IN-04: `test.skip()` without a reason argument

**File:** `e2e/ui/interview-me.spec.ts` (8 A6-gap skips)
**Commit:** `786b6866`
**Applied fix:** All 8 bare `test.skip()` calls now carry `test.skip("A6 gap: mock-agui interrupt payload is exclusive-only")` — the reason mirrors the file-header rationale and is now greppable/reported by Playwright.

## Skipped Issues

None — all 10 in-scope findings were fixed.

## Verification (gates)

All gates ran in the isolated review-fix worktree (`/tmp/sv-06-reviewfix-Hrnfhj`, branch `gsd-reviewfix/06-60959`) with `node_modules` symlinked from the main checkout — reproducible from the main checkout after the branch fast-forward, since no code differs between the two trees at the end.

| Gate | Result |
|---|---|
| `bun run build` | PASS (EXIT 0) |
| `bun run typecheck` | PASS (EXIT 0) |
| `bun test e2e/api/copilotkit/sse-text-diff.test.ts` | 6/6 pass (incl. both new connect-parity tests) |
| `bun test e2e/ui/fixtures/mock-agui.test.ts` | 23/23 pass |
| Affected specs + tripwires (chat, chat-session-drawer, autocomplete, stream-reactivity, code-server, extended-chat, interview-me, chat-copilotkit, board, board-ws-updates) | 167 pass, 8 skipped (intentional A6-gap skips), 0 fail |
| Full Playwright suite `npx playwright test` | **517 pass, 8 skipped (A6 gaps), 0 fail** |

Logic-verification note: WR-04 (poll-true), WR-06 (poll-true), WR-05 (poll thresholds) and the WR-01 connect contract assertions were all exercised against the real server / real browser in the gates above, so no finding was committed as "requires human verification" without runtime evidence.

---

_Fixed: 2026-08-09T15:44:34Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
