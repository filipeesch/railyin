---
phase: 05-chat-ui-replacement-vue
reviewed: 2026-08-09T00:00:00Z
depth: standard
files_reviewed: 18
files_reviewed_list:
  - src/mainview/components/chat/RailyinChat.vue
  - src/mainview/components/chat/ChatThreadSidebar.vue
  - src/mainview/components/chat/DecisionInterrupt.vue
  - src/mainview/components/chat/InterruptBridge.vue
  - src/mainview/components/chat/tool-call-renderers/ShellOutputRenderer.vue
  - src/mainview/components/chat/tool-call-renderers/FileChangesRenderer.vue
  - src/mainview/components/chat/tool-call-renderers/DelegateSummaryRenderer.vue
  - src/mainview/utils/toolCardDisplay.ts
  - src/mainview/utils/decisionRequest.ts
  - src/mainview/composables/useCommandsCache.ts
  - src/mainview/App.vue
  - src/mainview/views/BoardView.vue
  - src/mainview/components/TaskChatView.vue
  - src/mainview/components/SessionChatView.vue
  - src/mainview/main.ts
  - e2e/ui/fixtures/mock-agui.ts
  - e2e/ui/fixtures/index.ts
  - e2e/ui/chat-copilotkit.spec.ts
findings:
  critical: 1
  warning: 5
  info: 7
  total: 13
status: clean
---

# Phase 5: Code Review Report

**Reviewed:** 2026-08-09T00:00:00Z
**Depth:** standard
**Files Reviewed:** 18
**Status:** issues_found

## Summary

Reviewed the CopilotKit Vue v2 chat swap (RailyinChat wrapper + domain tool renderers + DecisionInterrupt + ChatThreadSidebar + AG-UI e2e mocks) against the SDK surface in `node_modules/@copilotkit/vue` (slot props, `useInterrupt`/`useAgent` semantics, interrupt state lifecycle) and the server contract (`src/bun/copilotkit/event-bridge.ts`).

The wiring is largely sound: slot names match the SDK's `tool-call-${string}` template-literal type, the resume payload matches the server's INVALID_PAYLOAD contract (non-empty `answers`, string `weight`/`notes` shapes), the toolsMenu/commands-cache ref plumbing is correct, and the mock AG-UI fixture faithfully mirrors the wire format.

Key concerns: (1) unsanitized `v-html` markdown rendering of agent/tool-controlled content — a stored XSS vector (ASVS L1 scope); (2) the "answered" decision replay branch (D-08) is provably dead — `useInterrupt()` is wired without a `handler`, so the slot's `result` prop is always `null`; (3) stale chat state leaks across thread switches; (4) the new `isErrorResult` content heuristic produces false error states on successful tool output.

## Critical Issues

### CR-01: Unsanitized `v-html` markdown rendering — stored XSS from agent/tool-controlled content

**File:** `src/mainview/components/chat/DecisionInterrupt.vue:13,17,83` and `src/mainview/components/chat/tool-call-renderers/DelegateSummaryRenderer.vue:16,27`
**Issue:** Both components render `marked.parse()` output through `v-html` without any sanitization (`renderMd` in DecisionInterrupt, `useMarkdown().renderMd` in DelegateSummaryRenderer). `marked` (v5+) does not sanitize raw HTML — it passes tags through verbatim. The rendered content is remote-controlled: interrupt `context`/`question`/option `description` metadata is composed from engine/LLM output (which is prompt-injectable via repository files, PR text, or tool results the model reads), and the subagent `prompt`/`result` is model/tool output. A `<img src=x onerror=…>` or `<iframe srcdoc=…>` embedded in any of those fields executes when the decision card or delegate card renders (script tags via `innerHTML` don't run, but event handlers and iframes do). This is a stored XSS vector in scope for ASVS L1 and is not mitigated anywhere in the codebase (no DOMPurify import exists; `grep` confirms). Note: the legacy DecisionRequest.vue / SubagentBlock.vue share the flaw, so this is a parity port — but the phase's security scope explicitly calls out XSS via markdown/tool content, and shipping the port reproduces the vulnerability.
**Fix:** Sanitize the rendered HTML before injection, e.g. `DOMPurify.sanitize(marked.parse(content, { async: false }))`, or escape/`v-text` the content. Apply in both components (and ideally to the legacy counterparts for consistency). If DOMPurify is added, keep the mermaid `<pre class="mermaid">` pass-through intact (mermaid's strict security level already sanitizes diagram markup).

## Warnings

### WR-01: D-08 "answered" decision summary can never render — `result` is always null

**File:** `src/mainview/components/chat/DecisionInterrupt.vue:198-215`, `src/mainview/components/chat/InterruptBridge.vue:20`
**Issue:** `answered = computed(() => props.result != null)` gates the "Decision recorded" collapsed summary. In the installed SDK bundle (`use-render-activity-message-*.js`, `useInterrupt` implementation), `result` is only ever set from a **custom** `handler` return value: `w = e.handler; if (!w) { s.value = null; return; }`. `InterruptBridge.vue` calls `useInterrupt()` with no config, so no handler exists, `result` stays `null` forever, and the answered/replay branch (Phase 3 D-08 contract, commented at DecisionInterrupt.vue:152-153) is dead code. On thread reopen after a resolved interrupt, the pending card re-renders instead of the answered summary (the mock's connect replay never exercises the interrupt variant, so no test catches this).
**Fix:** Either pass a handler that returns the recorded outcome, e.g. `useInterrupt({ handler: (props) => props.interrupt ? { status: "resolved", payload: (props.interrupt as Interrupt).metadata } : null })`, or drop the answered branch and document that replay shows the pending card; add an e2e connect-replay variant for the interrupt script that asserts the chosen behavior.

### WR-02: Stale `stopRequested` / `runError` leak across thread switches

**File:** `src/mainview/components/chat/RailyinChat.vue:259-278,290-293`
**Issue:** `stopRequested` and `runError` are only cleared in `onRunInitialized`. RailyinChat stays mounted when the drawer switches tasks (TaskChatView `:task-id` changes, drawer stays open, same component instance) or when SessionChatView switches sessions. Switching to a fresh thread after stopping/erroring the previous one shows the "Stopped" chip or the "Execution failed" row on the new thread until its first run — misleading UI state from a different conversation. The run error also re-fires the toast on thread switch if `runError` is re-triggered by the new subscription? No — but the row itself persists.
**Fix:** Add a `watch(() => props.threadId, () => { stopRequested.value = false; runError.value = null; })` (or reset inside the agent re-subscribe in the existing `watch(agent)`).

### WR-03: `isErrorResult` content heuristic flags successful tool output as failed

**File:** `src/mainview/utils/toolCardDisplay.ts:78`
**Issue:** `return /^\s*(error|failed|failure|exit code)/i.test(result)` — any tool result whose first line starts with `error`, `failed`, `failure`, or `exit code` renders the red error icon, even when the call succeeded. Real cases: `grep -i error …` output, `ls` on files named `error*`, or a script echoing `exit code 0`. The legacy ToolCallBlock derived error state from the wire `status` field; this speculative content heuristic is new and has no success-side discriminator. (The JSON branches at lines 65-74 are fine; only the raw-text fallback is problematic.)
**Fix:** Tighten the fallback, e.g. require `exit code` to be followed by a non-zero number (`/^\s*exit code [1-9]\d*/i`), drop bare `error`/`failed`/`failure` prefixes, or gate the heuristic on JSON-shaped input only.

### WR-04: ChatThreadSidebar rename can stick permanently on RPC failure; archive/create unhandled rejections

**File:** `src/mainview/components/chat/ChatThreadSidebar.vue:190-193,199-201,208-215`
**Issue:** `saveRename` awaits `chatStore.renameSession` without try/catch — if the RPC rejects, `renamingId` is never reset and the row stays in edit mode forever with no error feedback. `createNewSession` and `archiveSession` likewise have no error handling; a failed `chatSessions.create` leaves the user with nothing but an unhandled rejection, and a failed archive silently does nothing. These are user-initiated actions that should surface errors (toast) and reset local state.
**Fix:** Wrap each in try/catch with a toast (pattern already present in `runLegacyImport`), and move `renamingId.value = null` into a `finally`.

### WR-05: `MockAgui.knownThreadIds` is module-global and never reset — cross-test pollution

**File:** `e2e/ui/fixtures/mock-agui.ts:278,371-374`
**Issue:** `knownThreadIds` is a module-level `Set` that accumulates `registerThread()` calls across every test in a Playwright worker (the module loads once per worker). A later test that happens to reuse a previously registered threadId gets history replay instead of the empty-body never-run path — nondeterministic behavior that depends on test order. Currently masked by using unique ids, but the fixture's contract ("never-run threads get an empty body") is silently broken for reused ids.
**Fix:** Move the registry into the `MockAgui` instance (`this.knownThreadIds = new Set()` in the constructor) so each fixture setup starts clean.

## Info

### IN-01: Unused `title` prop in RailyinChat

**File:** `src/mainview/components/chat/RailyinChat.vue:194`
**Issue:** `title` is declared in `defineProps` but never referenced in the template or script — the header title is rendered by TaskChatView/SessionChatView. Both callers pass it, implying an intent (e.g., document title or aria-label) that isn't wired.
**Fix:** Either use it (e.g., `:aria-label` on the chat root, or a document.title effect) or remove it from the prop contract and callers.

### IN-02: ChatThreadSidebar never emits `close` — dead listener + no in-sidebar close affordance

**File:** `src/mainview/components/chat/ChatThreadSidebar.vue` (no `defineEmits`), `src/mainview/views/BoardView.vue:210-213`
**Issue:** BoardView binds `@close="chatSidebarOpen = false"` but the sidebar has no emit and no close button — the only close path is the header toolbar toggle. The `@close` listener is dead code; users inside the sidebar (e.g., after a long session list) must find the toolbar button.
**Fix:** Add a close (pi-times) button in the sidebar header that emits `close`, or drop the dead listener and document the toggle-only pattern.

### IN-03: Debug console.log in BoardView

**File:** `src/mainview/views/BoardView.vue:346-348`
**Issue:** `onWorkflowReloaded` logs `[BoardView] onWorkflowReloaded fired…` and the loaded columns to the console in production code.
**Fix:** Remove or gate behind `import.meta.env.DEV`.

### IN-04: Diff stat overcounts lines with trailing newline

**File:** `src/mainview/utils/toolCardDisplay.ts:102-109`
**Issue:** `content.split("\n").length` counts `"line1\nline2\n"` as 3 added lines (the trailing empty element). Same for `old_string`/`new_string`. Display-only (+N chip) inaccuracy; parity-wise the legacy FileDiff derived stats from actual hunks, so this is a regression in accuracy introduced by the args-based reconstruction.
**Fix:** Trim trailing newline before splitting (`content.replace(/\n$/, "").split("\n")`), or count `match(/\n/g)` occurrences + 1 with an empty-content guard.

### IN-05: `interruptBridgeState` module singleton retains stale hook after unmount

**File:** `src/mainview/components/chat/interruptBridge.ts:27`, `src/mainview/components/chat/InterruptBridge.vue:20`
**Issue:** When the last chat unmounts, the module ref keeps pointing at the unmounted hook. A newly mounted RailyinChat reads the stale `hasInterrupt` for one render pass (before its own bridge mounts and overwrites) — a one-frame flash of a wrongly-disabled input if the previous thread had a pending interrupt. Documented as acceptable in the header, but a simple fix exists.
**Fix:** Clear the holder on unmount: `onUnmounted(() => { if (interruptBridgeState.value === myState) interruptBridgeState.value = null; })` in InterruptBridge.

### IN-06: SessionChatView rename bypasses chatStore and fails silently

**File:** `src/mainview/components/SessionChatView.vue:150-159`
**Issue:** `commitTitle` calls `api("chatSessions.rename", …)` directly while ChatThreadSidebar uses `chatStore.renameSession` — inconsistent access paths for the same mutation. On failure it only `console.error`s: the input closes and the user's edit silently reverts with no feedback.
**Fix:** Use `chatStore.renameSession` for consistency and add a failure toast.

### IN-07: D-08 answered-replay path untested in e2e

**File:** `e2e/ui/fixtures/mock-agui.ts:290-338`, `e2e/ui/chat-copilotkit.spec.ts`
**Issue:** `buildConnectReplaySseBody` only special-cases `"toolcall"`; the `"interrupt"` script replays the quick sequence, so no test covers reopening a thread after an interrupt (WR-01's dead branch is therefore invisible to the suite). Add an interrupt replay variant once the answered-state behavior is decided (see WR-01).

---

_Reviewed: 2026-08-09T00:00:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
