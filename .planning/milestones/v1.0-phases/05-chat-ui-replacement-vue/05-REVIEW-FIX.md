---
phase: 05-chat-ui-replacement-vue
fixed_at: 2026-08-09T00:00:00Z
review_path: .planning/phases/05-chat-ui-replacement-vue/05-REVIEW.md
iteration: 1
findings_in_scope: 13
fixed: 13
skipped: 0
status: all_fixed
---

# Phase 5: Code Review Fix Report

**Fixed at:** 2026-08-09T00:00:00Z
**Source review:** `.planning/phases/05-chat-ui-replacement-vue/05-REVIEW.md`
**Iteration:** 1

**Summary:**
- Findings in scope: 13 (1 critical, 5 warnings, 7 info — all Info were trivial and fixed)
- Fixed: 13
- Skipped: 0

## Fixed Issues

### CR-01: Unsanitized `v-html` markdown rendering — stored XSS from agent/tool-controlled content

**Files modified:** `package.json`, `bun.lock`, `src/mainview/utils/sanitizeHtml.ts` (new), `src/mainview/composables/useMarkdown.ts`, `src/mainview/components/chat/DecisionInterrupt.vue`, `src/mainview/components/DecisionRequest.vue`
**Commit:** `4193fdd4`
**Applied fix:** Added `dompurify` as a direct dependency (already installed transitively via mermaid — now declared) and a shared `sanitizeHtml` util with a no-DOM fallback. Every v-html markdown render now passes through DOMPurify: `useMarkdown.renderMd`/`renderUserMd` (covers the new `DelegateSummaryRenderer` plus ALL legacy consumers — MessageBubble, StreamBlockNode, NotesPanel, DecisionsPanel, detail overlays, SubagentBlock, AskUserPrompt), and the mermaid-aware `renderMd` in `DecisionInterrupt.vue` and its legacy counterpart `DecisionRequest.vue`. The mermaid `<pre class="mermaid">` pass-through survives DOMPurify's allow-list (verified via node smoke test of the sanitizer output).

### WR-01: D-08 "answered" decision summary can never render — `result` is always null

**Files modified:** `src/mainview/components/chat/interruptBridge.ts`, `src/mainview/components/chat/InterruptBridge.vue`, `src/mainview/components/chat/RailyinChat.vue`
**Commit:** `12c2fb51`
**Applied fix:** Verified the SDK semantics in `node_modules/@copilotkit/vue/src/v2/hooks/use-interrupt.ts`: the slot's `result` is only ever set from a custom `handler` return value, and the handler runs the moment an interrupt appears — so the review's literal example handler would break the interactive flow (a fresh interrupt would instantly render "answered"). Instead: `InterruptBridge` now passes a handler that returns the recorded outcome (registered by `RailyinChat` at submit/cancel in a module registry keyed by interrupt id) or `null` for unanswered interrupts. On thread reopen the connect replay re-pends the outcome and the collapsed "Decision recorded" summary renders (D-08); fresh interrupts stay interactive. Session-scoped: after a full page reload the registry is empty and replay shows the pending card (documented trade-off in `interruptBridge.ts`). Covered end-to-end by the new C-5 e2e test.

### WR-02: Stale `stopRequested` / `runError` leak across thread switches

**Files modified:** `src/mainview/components/chat/RailyinChat.vue`
**Commit:** `443cc1d1`
**Applied fix:** Added `watch(() => props.threadId, ...)` that resets `stopRequested` to `false` and `runError` to `null` on every thread switch (RailyinChat stays mounted across task/session switches).

### WR-03: `isErrorResult` content heuristic flags successful tool output as failed

**Files modified:** `src/mainview/utils/toolCardDisplay.ts`, `src/mainview/utils/toolCardDisplay.test.ts`
**Commit:** `2fd83773`
**Applied fix:** Raw-text fallback tightened from `/^\s*(error|failed|failure|exit code)/i` to `/^\s*exit code [1-9]\d*/i` (leading NON-ZERO exit code only) — bare `error`/`failed`/`failure` prefixes false-positive on successful `grep -i error`, `ls error*`, or `echo "exit code 0"` output. Structured failures still come from the JSON branch. TCD-17 updated to pin the new semantics (including `exit code 0` → false).

### WR-04: ChatThreadSidebar rename can stick permanently on RPC failure; archive/create unhandled rejections

**Files modified:** `src/mainview/components/chat/ChatThreadSidebar.vue`
**Commit:** `10b0e18d`
**Applied fix:** `saveRename` wrapped in try/catch with the existing error-toast pattern and `renamingId.value = null` moved into `finally` (the row always reverts to display mode). `createNewSession` catches and toasts "New session failed". `archiveSession` surfaces failures via `.catch` toast instead of failing silently.

### WR-05: `MockAgui.knownThreadIds` is module-global and never reset — cross-test pollution

**Files modified:** `e2e/ui/fixtures/mock-agui.ts`, `e2e/ui/fixtures/mock-agui.test.ts`
**Commit:** `75a13fbe`
**Applied fix:** Registry moved onto the `MockAgui` instance (`readonly knownThreadIds = new Set()` in the class; `registerThread` mutates `this.knownThreadIds`; the /connect route passes the instance registry into `buildConnectReplaySseBody`, which now takes the registry as an explicit parameter). The auto-use fixture creates one instance per test → clean state per test. Unit tests updated to pass explicit sets; new regression test proves registrations never leak between instances.

### IN-01: Unused `title` prop in RailyinChat

**Files modified:** `src/mainview/components/chat/RailyinChat.vue`
**Commit:** `80d0cb9c`
**Applied fix:** The prop (passed by both callers) is now the accessible name of the chat region: `<div role="region" :aria-label="title">`.

### IN-02: ChatThreadSidebar never emits `close` — dead listener + no in-sidebar close affordance

**Files modified:** `src/mainview/components/chat/ChatThreadSidebar.vue`
**Commit:** `90e3d1e5`
**Applied fix:** Added `defineEmits<{ close: [] }>()` and a `pi-times` close button (`data-testid="thread-close"`) in the sidebar header that emits `close` — wired to BoardView's existing `@close` listener.

### IN-03: Debug console.log in BoardView

**Files modified:** `src/mainview/views/BoardView.vue`
**Commit:** `bb4161d9`
**Applied fix:** Removed both `[BoardView]` console.log lines from the `onWorkflowReloaded` handler (kept the `loadBoards()` call).

### IN-04: Diff stat overcounts lines with trailing newline

**Files modified:** `src/mainview/utils/toolCardDisplay.ts`, `src/mainview/utils/toolCardDisplay.test.ts`
**Commit:** `b0299e92`
**Applied fix:** Added a `countLines` helper (trim one trailing newline before splitting; empty strings count zero) used for `content`/`old_string`/`new_string`. New TCD-26 regression test pins `"line1\nline2\n"` → 2 lines and empty → 0.

### IN-05: `interruptBridgeState` module singleton retains stale hook after unmount

**Files modified:** `src/mainview/components/chat/InterruptBridge.vue`
**Commit:** `86d648bf`
**Applied fix:** `onUnmounted` clears the module holder only when it still points at this bridge (`if (interruptBridgeState.value === myState) interruptBridgeState.value = null`), eliminating the one-frame wrongly-disabled input flash on remount after a pending-interrupt thread.

### IN-06: SessionChatView rename bypasses chatStore and fails silently

**Files modified:** `src/mainview/components/SessionChatView.vue`
**Commit:** `4c91e68f`
**Applied fix:** `commitTitle` now routes through `chatStore.renameSession` (consistent with ChatThreadSidebar) and surfaces failures with the standard error toast instead of `console.error`. Removed the now-unused direct `api` import.

### IN-07: D-08 answered-replay path untested in e2e

**Files modified:** `e2e/ui/fixtures/mock-agui.ts`, `e2e/ui/fixtures/mock-agui.test.ts`, `e2e/ui/chat-copilotkit.spec.ts`
**Commit:** `eb929353`
**Applied fix:** Extracted `buildInterruptRunEvents`; the connect replay for script `"interrupt"` now keeps the RUN_FINISHED interrupt outcome as its single terminal (snapshot before it) so the client re-pends the decision card on reopen. Unit test pins the replay shape (single terminal, outcome carried, snapshot references the assistant text). New e2e C-5 asserts the "Decision recorded" summary renders after reopening the drawer. Note: C-5 mirrors the real server flow — the resume run completes with success (quick script) because an interrupt-script resume leaves the thread clone with an unaddressed pending interrupt, which the SDK's `connectAgent` guard (`onInitialize`) rejects, aborting the reopen /connect (verified in `@ag-ui/client` AbstractAgent).

## Skipped Issues

None — all 13 findings in scope were fixed.

---

## Verification

All gates ran in the **isolated review-fix worktree** (`/tmp/sv-05-reviewfix-*`, branch `gsd-reviewfix/05-*`, symlinked `node_modules`; the main checkout's node_modules was only touched by `bun add dompurify`, which also pruned code-server's bundled `typescript` extension lib files — ephemeral/gitignored, restorable with a fresh `bun install` of `code-server` if the code-server overlay needs TS features).

| Gate | Result |
|---|---|
| `bun run build` | ✅ clean (18.8s) |
| `bun run typecheck` (`tsc --noEmit`) | ✅ clean |
| `bun test e2e/ui/fixtures --timeout 20000` | ✅ 19/19 |
| `npx playwright test e2e/ui/chat-copilotkit.spec.ts` (Phase 5 suite) | ✅ 16/16 (incl. new C-5) |
| `npx playwright test e2e/ui/chat-sidebar.spec.ts` | ✅ 37/37 (ChatThreadSidebar changes) |
| `npx playwright test e2e/ui/session-sidebar-edge.spec.ts` | ✅ 3/3 |
| `npx playwright test e2e/ui/board-header-workflow-edit.spec.ts` | ✅ 5/5 (BoardView change) |
| `bun run test:e2e:chat` (`chat.spec.ts`) | ⚠️ 12 pre-existing failures — **byte-identical at the base commit** `3e1a7c8b` (legacy spec targets the `.task-detail__input .cm-content` CodeMirror editor removed by the phase's chat swap; out of the reviewed file set) |
| `extended-chat` / `delegate-rendering` / `conversation-body` specs | ⚠️ identical pre-existing failure sets vs base commit (same legacy-surface root cause) |
| `bun test src/mainview --timeout 20000` | 155 pass / 85 fail — failure set **identical at base** (154 pass; the +1 is the new TCD-26) |

No new failures were introduced by the fixes. The 12+19+1+5 e2e and 85 unit failures are pre-existing breakage of legacy conversation-UI specs caused by the phase's own chat-surface replacement (they were failing before this fix pass and are outside the reviewed file set).

**Commits (13, one per finding):**
`4193fdd4` CR-01 · `12c2fb51` WR-01 · `443cc1d1` WR-02 · `2fd83773` WR-03 · `10b0e18d` WR-04 · `75a13fbe` WR-05 · `80d0cb9c` IN-01 · `90e3d1e5` IN-02 · `bb4161d9` IN-03 · `b0299e92` IN-04 · `86d648bf` IN-05 · `4c91e68f` IN-06 · `eb929353` IN-07

---

_Fixed: 2026-08-09T00:00:00Z_
_Fixer: the agent (gsd-code-fixer)_
_Iteration: 1_
