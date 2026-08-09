---
phase: 06-e2e-migration-verification
reviewed: 2026-08-09T12:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - e2e/ui/fixtures/mock-agui.ts
  - e2e/ui/fixtures/mock-agui.test.ts
  - e2e/ui/fixtures/helpers.ts
  - e2e/ui/fixtures/index.ts
  - e2e/ui/conversation-stream-state.spec.ts
  - e2e/ui/chat.spec.ts
  - e2e/ui/delegate-rendering.spec.ts
  - e2e/ui/conversation-body.spec.ts
  - e2e/ui/tool-rendering.spec.ts
  - e2e/ui/stream-reactivity.spec.ts
  - e2e/ui/timeline-pipeline.spec.ts
  - e2e/ui/chat-session-drawer.spec.ts
  - e2e/ui/interview-me.spec.ts
  - e2e/ui/autocomplete.spec.ts
  - e2e/ui/cursor.spec.ts
  - e2e/ui/task-drawer.spec.ts
  - e2e/ui/extended-chat.spec.ts
  - e2e/ui/code-server.spec.ts
findings:
  critical: 0
  warning: 6
  info: 4
  total: 10
status: clean
---

# Phase 6: Code Review Report

**Reviewed:** 2026-08-09T12:00:00Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Reviewed the 13 migrated spec files plus the `mock-agui` fixture layer (fixture, fixture unit tests, helpers, fixture index) at standard depth, cross-checking the fixture against the real wire contract: the `@copilotkit/runtime` in-memory runner source (`in-memory.mjs`), the `@ag-ui/client` event-apply/merge semantics, the real-server connect assertions in `e2e/api/copilotkit/railyin.test.ts`, and the frozen canonical spec (`chat-copilotkit.spec.ts`).

Overall the migration is high quality: per-instance thread/history registries correctly eliminate cross-test pollution (WR-05 pattern), the `registerHistory` knob is a clean backward-compatible extension, retire rationale is consistently documented, and the client-visible final states of the fixture's replay/run scripts were verified to match the actual `@ag-ui/client` MESSAGES_SNAPSHOT merge logic (id-based replace + append) — the suite's green status is consistent with the client's real semantics, not an accident.

No BLOCKERs. The main concerns: (1) the connect-replay framing diverges from what the real runner emits (synthetic MESSAGES_SNAPSHOT) despite the header's "never drift" claim, which makes the dominant S-2 history pattern untested against the real event-replay path; (2) several negative assertions (`runInputs` length) are false-negative capable and would miss the exact regressions they guard; (3) a handful of fixed-settle `waitForTimeout` windows where `expect.poll` is the established project pattern (Pitfall 5).

## Warnings

### WR-01: Connect replay framing diverges from the real runner — the "never drift" claim overstates

**File:** `e2e/ui/fixtures/mock-agui.ts:314-380` (and header claim at :22-29)
**Issue:** The header asserts the fixture "can never drift from the real wire format," but the connect replay is a synthetic arrangement the real runtime never emits:
- The real in-memory runner's `connect()` (`node_modules/@copilotkit/runtime/dist/v2/runtime/runner/in-memory.mjs`, verified) replays **compacted historic events only** — RUN_STARTED → historic text/tool events → the historic RUN_FINISHED. It **never emits MESSAGES_SNAPSHOT** and never re-terminates the stream.
- The fixture emits historic quick/toolcall events + a **hand-rolled MESSAGES_SNAPSHOT** (test-authored messages) + a **synthetic terminal**.
- The real-server API test (`e2e/api/copilotkit/railyin.test.ts:10`) confirms the real shape: first frame RUN_STARTED, last frame RUN_FINISHED, no snapshot. The byte-diff test (`sse-text-diff.test.ts`) covers **only** the quick `/run` path.

Today the client-visible final state happens to be equivalent because `@ag-ui/client`'s MESSAGES_SNAPSHOT handler replaces the message list by id (verified in the client bundle), so the snapshot masks the replayed events. Consequences: (a) the S-2 history pattern (~15 migrated tests) exercises the snapshot-replace path, but never the real production history path (reconstructing messages from replayed TEXT/TOOL events) — a regression in the event-replay reconstruction would pass the mock suite and break against the real server; (b) the blanket "never drift" claim in the header is not true for the most-used endpoint of this phase.

**Fix:** Add a connect-replay comparison against the real server (extend `sse-text-diff.test.ts` or `railyin.test.ts` with a connect scenario asserting the fixture's frame sequence vs. the real compacted replay), or explicitly reword the header to scope the byte-parity claim to the `/run` path and document the snapshot as a synthetic client-contract convenience. The `railyin.test.ts` connect tests already exist — wire the fixture's replay to assert the same invariants (first RUN_STARTED / last RUN_FINISHED / snapshot merge behavior).

### WR-02: Negative `agui.runInputs` assertions are false-negative capable

**File:** `e2e/ui/chat.spec.ts:198` (N-8), `e2e/ui/chat-session-drawer.spec.ts:170` (CD-B-2), `:188` (CD-B-3), `e2e/ui/autocomplete.spec.ts:124` (AC-10)
**Issue:** `expect(agui.runInputs).toHaveLength(0)` (and N-8's `expect.poll(...).toBe(0)`, which passes immediately when already 0) runs right after the key press. A /run fired by the client is recorded by the route handler **asynchronously** (browser → Playwright route dispatch → handler → `push`), so a real regression (Shift+Enter submitting, empty editor submitting) would often escape detection — the exact bug each of these tests exists to catch.
**Fix:** Bound the negative window deterministically:
```ts
await page.keyboard.press("Shift+Enter");
await page.waitForTimeout(500); // allow any (buggy) submit to reach the fixture
expect(agui.runInputs).toHaveLength(0);
```
or assert a positive side-effect that is impossible when nothing was sent (e.g., for AC-10 keep `toHaveValue(/Line 1/)` and additionally assert the chat view has no new user message within a short window).

### WR-03: B-1 MutationObserver attach races the empty-state render

**File:** `e2e/ui/stream-reactivity.spec.ts:131-157`
**Issue:** The observer is attached after `expect(chat).toBeVisible()` + a fixed `waitForTimeout(200)`. For task1 (never-run thread) the connect replay resolves asynchronously and renders the empty state (`chat-empty-state`) — if the mocked round trip takes longer than 200ms on a loaded CI, the empty-state render is counted as a mutation and the test fails spuriously. The observer counts `subtree/childList/characterData` mutations of the chat view, i.e. any late initial render.
**Fix:** Settle the initial render deterministically before attaching — e.g. `await expect(page.locator('[data-testid="chat-empty-state"]')).toBeVisible()` (the empty state is the settled state for a never-run thread), replacing the fixed 200ms sleep; then attach the observer and push.

### WR-04: Call-state assertions gated by `waitForTimeout(300)` instead of polling

**File:** `e2e/ui/chat-session-drawer.spec.ts:447` (CD-D-5), `:644` (CD-I-1)
**Issue:** CD-D-5 asserts `expect(renameCalled).toBe(true)` after a fixed 300ms sleep — a slow CI can exceed 300ms (flake), and this is exactly the timing-assert pattern the project's own Pitfall 5 forbids. CD-I-1 asserts `expect(renameCalls).toHaveLength(0)` after 300ms — false-negative capable (a late rename call escapes). (CD-I-2's `waitForTimeout(300)` at :663 is acceptable because the follow-up assertions poll with default timeouts.)
**Fix:**
```ts
// CD-D-5
await expect.poll(() => renameCalled, { timeout: 3_000 }).toBe(true);
// CD-I-1 — bounded negative window
await page.waitForTimeout(500);
expect(renameCalls).toHaveLength(0);
```

### WR-05: Scroll assertions use single-shot evaluates / fixed settle windows instead of `expect.poll`

**File:** `e2e/ui/chat-session-drawer.spec.ts:536-542` (CD-E-4), `e2e/ui/stream-reactivity.spec.ts:347, 384, 419, 457` (E-3/E-4/E-5/E-6)
**Issue:** CD-E-4 computes `isAtBottom` in one `evaluate()` right after "Message 240" is visible — the autoscroll pinning runs after layout/nextTick, so the check can observe a not-yet-pinned scrollTop on slow machines. The E-suite's own E-1/E-7 use `expect.poll(() => distFromBottom(scroll))` — the established pattern — but E-3/E-4/E-5/E-6 use fixed `waitForTimeout(800)` "settle" windows before measuring; if the client's scroll work exceeds 800ms on a loaded CI the distance assertions fail spuriously.
**Fix:** Use `expect.poll` for the scroll-top/dist assertions (as E-1/E-7 already do), e.g. CD-E-4:
```ts
await expect.poll(() => page.locator('.session-chat-view [data-testid="copilot-chat-view-scroll"]')
  .evaluate((el) => (el as HTMLElement).scrollTop + (el as HTMLElement).clientHeight >= (el as HTMLElement).scrollHeight - 40))
  .toBe(true);
```

### WR-06: `startCalled` / `stopCalled` booleans asserted before the route handler can run

**File:** `e2e/ui/code-server.spec.ts:113` (CS-B-1), `:199` (CS-B-5)
**Issue:** `expect(startCalled).toBe(true)` runs after the overlay is visible. The overlay renders when the client's request is in flight; the mock handler sets `startCalled` only when the Playwright route dispatch executes — a genuine race window (overlay visible before the handler runs). Same for `stopCalled`.
**Fix:**
```ts
await expect.poll(() => startCalled, { timeout: 3_000 }).toBe(true);
```

## Info

### IN-01: Dead helper exports (`sendMessage`, `typeInSessionEditor`)

**File:** `e2e/ui/fixtures/helpers.ts:18-23, 45-54`, re-exported at `e2e/ui/fixtures/index.ts:145`
**Issue:** `sendMessage` (targets the removed CodeMirror `.task-detail__input .cm-content` surface) and `typeInSessionEditor` have no callers anywhere in `e2e/` — leftovers from the retired test set. Dead code that also advertises a legacy selector.
**Fix:** Remove both and drop them from the index re-export.

### IN-02: Direct `agui.stopRequests` assertion after the Stopped marker

**File:** `e2e/ui/chat.spec.ts:156` (N-6), `e2e/ui/chat-session-drawer.spec.ts:326, 714` (CD-C-4, CD-J-1), `e2e/ui/extended-chat.spec.ts:49, 72` (P-12, P-13)
**Issue:** The marker renders client-side when the aborted run finalizes; the /stop POST is recorded when the Playwright route handler executes. If the SDK dispatches the /stop and the abort without awaiting the POST, the assertion can race. The frozen canonical spec uses the same pattern (`chat-copilotkit.spec.ts:264`), so this is a shared hardening opportunity rather than a migration defect.
**Fix:** `await expect.poll(() => agui.stopRequests.includes(String(t.conversationId)), { timeout: 3_000 }).toBe(true)`.

### IN-03: Module-level mutable message-id counter

**File:** `e2e/ui/interview-me.spec.ts:44-66`
**Issue:** `let _msgId = 5000` is module-level state shared by every test in the file (and interleaved with `mock-data.ts`'s own `_nextMsgId`). Serial in-file execution keeps ids distinct today (and T-F/T-G pin the reply id to `promptMsg.id + 1`), but any future parallelization or test reordering silently shifts ids. Prefer a per-test counter or explicit ids.
**Fix:** Move the counter inside `makeInterviewPrompt`'s callers or use explicit literal ids (the two consumers hard-pin the reply id already).

### IN-04: `test.skip()` without a reason argument

**File:** `e2e/ui/interview-me.spec.ts:465-497` (A6-gap skips)
**Issue:** The 8 A6-gap skips call `test.skip()` bare; the rationale lives only in comments, so Playwright reports show no skip reason and the gap is not greppable as a tracked debt item.
**Fix:** `test.skip("A6 gap: mock-agui interrupt payload is exclusive-only")` — mirrors the file-header rationale in the report output.

---

_Reviewed: 2026-08-09T12:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
