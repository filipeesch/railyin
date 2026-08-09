# Phase 5: Chat UI Replacement (Vue) - Pattern Map

**Mapped:** 2026-08-09
**Files analyzed:** 13 (8 new / 5 modified; +3 stay-alive boundary files)
**Analogs found:** 12 / 13 (RailyinChat.vue has no in-repo analog — RESEARCH.md verified code example)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/mainview/components/chat/RailyinChat.vue` (NEW) | component (wrapper) | streaming (SSE chat) | `ConversationDrawer.vue` (non-scoped global CSS block overriding third-party internals) + RESEARCH.md verified skeleton | partial (no CopilotKit analog in repo) |
| `src/mainview/components/chat/ChatThreadSidebar.vue` (NEW) | component (sidebar) | request-response (CRUD over sessions) | `ChatSidebar.vue` | exact (port source) |
| `src/mainview/components/chat/DecisionInterrupt.vue` (NEW) | component (interrupt card) | event-driven (interrupt→resume) | `DecisionRequest.vue` + `MessageBubble.vue` (decision_request_prompt render site) | exact (port source) |
| `src/mainview/components/chat/tool-call-renderers/ShellOutputRenderer.vue` (NEW) | component (renderer) | transform (tool result → pre) | `ToolCallBlock.vue` (output branch) + `useToolResultDisplay.ts` + `toolCallDisplay.ts` | exact (port source) |
| `src/mainview/components/chat/tool-call-renderers/FileChangesRenderer.vue` (NEW) | component (renderer) | transform (diff/file → hunk viewer) | `FileDiff.vue` + `ReadView.vue` + `ToolCallBlock.vue` (diffPayloads branch) | exact (port source) |
| `src/mainview/components/chat/tool-call-renderers/DelegateSummaryRenderer.vue` (NEW) | component (renderer) | transform (subagent result → card) | `SubagentBlock.vue` + `useMarkdown.ts` | exact (port source) |
| `src/mainview/composables/useCommandsCache.ts` (MODIFY) | composable | request-response (engine.listCommands) | itself — extend with session path + toolsMenu mapping | role-match |
| `src/mainview/App.vue` (MODIFY) | root component | — (provider mount) | no analog — RESEARCH.md verified provider code example | no-match (use research) |
| `src/mainview/main.ts` (MODIFY) | config/bootstrap | — (global CSS import) | itself (lines 7-8 CSS import pattern) | exact |
| `src/mainview/views/BoardView.vue` (MODIFY) | view | request-response (layout) | itself (ChatSidebar mount site lines 210-213) | exact |
| `src/mainview/components/TaskChatView.vue` (MODIFY) | view | streaming (chat tab) | itself (Chat tab branch lines 118-177) | exact |
| `src/mainview/components/SessionChatView.vue` (MODIFY) | view | streaming (chat tab) | itself (Chat tab branch lines 74-128) | exact |
| `e2e/ui/fixtures/mock-agui.ts` (MODIFY) | test fixture | event-driven (SSE routes) | itself (install() dispatch pattern) | exact |
| `e2e/ui/fixtures/index.ts` (MODIFY) | test fixture | — (fixture wiring) | itself (extend pattern) | exact |
| `e2e/ui/chat-copilotkit.spec.ts` (NEW) | e2e test | event-driven (MockAgui SSE) | `e2e/ui/extended-chat.spec.ts` / `chat.spec.ts` | role-match |
| unit tests for renderers + toolsMenu mapping + DecisionInterrupt (NEW) | test | — | `src/mainview/utils/decisionRequest.test.ts`, `src/mainview/composables/useCommandsCache.test.ts` | role-match |

**Stay-alive boundary files (NOT modified, NOT imported by RailyinChat — D-10):** `src/mainview/stores/conversation.ts`, `src/mainview/stores/chat.ts`, `src/mainview/rpc.ts` — their push handlers keep running for board/session chrome; RailyinChat must NOT read `conversationStore.messages`.

---

## Pattern Assignments

### `src/mainview/components/chat/RailyinChat.vue` (NEW — component, streaming)

**Analog:** `ConversationDrawer.vue` for the non-scoped third-party-CSS-override block; RESEARCH.md §Code Examples (verified against installed `@copilotkit/vue@1.66.4`) for the CopilotChat surface.

**Provider mount (in `App.vue`, not here):**
```vue
<template>
  <CopilotKitProvider runtime-url="/api/copilotkit">
    <RouterView />
  </CopilotKitProvider>
</template>
```
(CopilotKitProvider.types.d.ts — NO publicApiKey/licenseToken; import from `@copilotkit/vue/v2`.)

**Core wrapper skeleton (RESEARCH.md lines 297-346, verified from `CopilotChat.vue.d.ts`):**
```vue
<template>
  <CopilotChat
    :thread-id="threadId"            <!-- String(conversationId) — auto-connect + JSONL replay (CHAT-07) -->
    :input-tools-menu="toolsMenu"    <!-- from useCommandsCache (CHAT-06) -->
    :welcome-screen="false"
    class="railyn-chat"
    @stop="onStop"
  >
    <template #interrupt="{ event, interrupt, resolve, cancel }">
      <DecisionInterrupt :interrupt="interrupt" @submit="(p) => resolve(p)" @cancel="() => cancel()" />
    </template>
    <template #tool-call-subagent="{ name, args, status, result }">
      <DelegateSummaryRenderer :args="args" :status="status" :result="result" />
    </template>
    <!-- bash/run/run_in_terminal → ShellOutputRenderer;
         read/read_file/view/write/write_file/create/edit/multiedit/apply_patch → FileChangesRenderer -->
    <template #input="{ modelValue, isRunning, inputToolsMenu, onUpdateModelValue, onSubmitMessage, onStop }">
      <CopilotChatInput
        v-model="modelValue"
        :is-running="isRunning"
        :tools-menu="inputToolsMenu"
        :disabled="hasInterrupt"
        @update:model-value="onUpdateModelValue"
        @submit-message="onSubmitMessage"
        @stop="onStop"
      />
    </template>
  </CopilotChat>
</template>
<script setup lang="ts">
import { CopilotChat, CopilotChatInput, useAgent, useInterrupt, useDefaultRenderTool } from "@copilotkit/vue/v2";
useDefaultRenderTool();                                   // default card for all non-domain tools (D-04)
const { hasInterrupt } = useInterrupt();                  // publishes interrupt → #interrupt slot
const { agent } = useAgent({ agentId: "default" });
function onStop() { stopRequested.value = true; agent.value?.abortRun(); }
</script>
```

**Critical rules (from RESEARCH.md):**
- Slot names MUST be exactly `tool-call-${toolCallName}` (template-literal slot type `[key: \`tool-call-${string}\`]`). Declare ALL canonical family names (tool-display.ts verified families in RESEARCH Pattern 2). Do NOT declare a generic `#tool-call` slot — it short-circuits `useDefaultRenderTool` for every tool.
- ALWAYS pass `:thread-id="String(conversationId)"` — server rejects non-numeric threadIds with `THREAD_NOT_FOUND` (`railyin-agent.ts:223-224`).
- "Stopped" label = wrapper-local state: `stopRequested` set on stop click, cleared on next submit; render the marker when `stopRequested && !isRunning`. The wire emits aborted runs as plain `RUN_FINISHED {result: null}` (`event-bridge.ts:318-328`) — NEVER derive the label from wire events.

**CSS override pattern** — copy from `ConversationDrawer.vue` lines 143-177 (non-scoped `<style>` block overriding a third-party component's internals, no `scoped` attr):
```css
/* Non-scoped style block in RailyinChat.vue — single home for ALL CopilotKit CSS overrides (D-01) */
.railyn-chat :deep(p) { margin: 0 0 0.6em; line-height: 1.6; }   /* port ConversationBody.vue:608-627 parity rules */
.railyn-chat :deep(pre) { background: var(--p-surface-900, #0f172a); color: var(--p-surface-100, #f1f5f9);
  border-radius: 8px; padding: 12px 14px; overflow-x: auto; margin: 0.6em 0; font-size: 0.8rem; line-height: 1.5; }
.railyn-chat :deep(code) { font-family: ui-monospace, monospace; font-size: 0.82em;
  background: var(--p-content-hover-background); border-radius: 4px; padding: 1px 5px; }
```

**Markdown parity rules to port** (from `ConversationBody.vue` lines 608-627 — `p`, `h1-h4`, `ul/ol`, `li`, `code`, `pre`; and `MessageBubble.vue` lines 266-350 adds `blockquote`, `table`, `hr`, `a`). Import `@copilotkit/vue/styles.css` once in `main.ts` and verify no board-layout regression (67KB Tailwind v4 with `@layer base` preflight can leak — RESEARCH Pitfall 4).

---

### `src/mainview/components/chat/ChatThreadSidebar.vue` (NEW — component, request-response)

**Analog:** `ChatSidebar.vue` (port source — same role, same data flow).

**Imports pattern** (ChatSidebar.vue:89-95):
```typescript
import { ref, computed } from "vue";
import Button from "primevue/button";
import InputText from "primevue/inputtext";
import { useChatStore } from "../stores/chat";
import { useWorkspaceStore } from "../stores/workspace";
import type { ChatSession } from "@shared/rpc-types";
import { readStorage, writeStorage } from "../utils/storage";
```

**Resizable width pattern** (ChatSidebar.vue:102-128) — copy verbatim; add "Legacy Import" action button (`data-testid="legacy-import-btn"` per UI-SPEC test ids) + "New Session" (`data-testid="thread-new"`):
```typescript
const SIDEBAR_MIN = 160;
const SIDEBAR_MAX = 400;
const STORAGE_KEY = "chat-sidebar-width";
function loadWidth(): number {
  const stored = readStorage<number | null>(STORAGE_KEY, null);
  return stored === null ? 220 : Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, stored));
}
const sidebarWidth = ref(loadWidth());
function startResize(e: MouseEvent) {
  const startX = e.clientX;
  const startWidth = sidebarWidth.value;
  function onMove(ev: MouseEvent) {
    const delta = startX - ev.clientX;
    sidebarWidth.value = Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, startWidth + delta));
  }
  function onUp() {
    writeStorage(STORAGE_KEY, sidebarWidth.value);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  }
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}
defineExpose({ sidebarWidth });
```

**Item row pattern** (ChatSidebar.vue:19-83): status dot `:class="status-dot--${session.status}"`, title ellipsis, `relativeTime(session.lastActivityAt)` (lines 140-150), unread dot (lines 313-319), hover actions rename/archive (lines 62-82). **Enrichment note (RESEARCH Pitfall 6):** `ThreadSummary` has NO status/unread fields (`rpc-types.ts:111-121`) — enrich session threads from the still-live `chatSessions.list` via `useChatStore`; card threads show no unread dot in v1. Empty state: "No sessions yet" / "Start a new session to begin." (UI-SPEC Copywriting Contract).

---

### `src/mainview/components/chat/DecisionInterrupt.vue` (NEW — component, event-driven)

**Analog:** `DecisionRequest.vue` (port source — the interview card) + `MessageBubble.vue:38-45` (render site: passes `:questions`, `:context`, `:answered-text`, listens `@submit`).

**Slot data contract** (RESEARCH.md lines 353-359, verified):
```typescript
// #interrupt slot props: { event: { name: "on_interrupt", value: Interrupt }, interrupt, interrupts, result, resolve, cancel }
// Interrupt = { id, reason: "decision_request", message?, metadata?: Record<string, any> }
// interrupt.metadata = DecisionRequestPayload = { context?: string; questions: DecisionRequestQuestion[] }  [rpc-types.ts:304-307]
// resolve({ decision: "approved", answers, generalNotes, recordAsDecisions }) → resume[] → POST /run
//   [event-bridge.ts:380-422 — a resolved resume MUST carry non-empty answers else INVALID_PAYLOAD]
// Phase 3 D-02: status "cancelled" → rejection
```

**Ported form logic** — copy from `DecisionRequest.vue`:
- Import the pure helpers (`DecisionRequest.vue:136-142`): `canSubmitDecisionRequest`, `buildDecisionAnswers`, `buildSubmissionText`, `isOptionSelected`, `DecisionRequestState` from `../utils/decisionRequest` (helpers are already unit-tested in `decisionRequest.test.ts` — reuse, don't re-derive).
- Weight labels (`DecisionRequest.vue:209-213`): critical → "⚠️ Hard to change later", medium → "🔄 Can change with effort", easy → "💡 Easy to revisit".
- "AI suggests" badge when `q.model_lean === opt.title` (line 50); model lean line (17-20); "Record as decisions" toggle + Submit button (120-127).
- `mermaid` renderer setup (`DecisionRequest.vue:144-161`) — reuse for context markdown.
- Submit disabled until `canSubmitDecisionRequest` (line 251); on submit emit payload, map to `{ decision: "approved", answers: buildDecisionAnswers(...), generalNotes, recordAsDecisions }` for `resolve()`.

**Weight badge palette** (`DecisionRequest.vue:306-329` light + 571-584 dark) — ported hexes verbatim (UI-SPEC Color section).

**Answered state (D-08 replay):** collapsed summary when the interrupt is already resolved — the `result`/`interrupts` slot props carry resolution status; reuse the `answeredText` pattern from `MessageBubble.vue:206-212`.

---

### `src/mainview/components/chat/tool-call-renderers/ShellOutputRenderer.vue` (NEW — renderer, transform)

**Analog:** `ToolCallBlock.vue` (output branch).

**Core pattern** (ToolCallBlock.vue:79-106):
```typescript
import { useToolResultDisplay } from "../composables/useToolResultDisplay";
import { formatToolSubject } from "../utils/toolCallDisplay";

const input = computed(() => ({ result: props.result, contentType: props.contentType }));
const { displayText } = useToolResultDisplay(input);   // detailedContent → contents[] → content → raw

const truncated = computed(() => {
  const c = displayText.value;
  return c.length > 800 ? c.slice(0, 800) + "\n…[truncated]" : c;   // 800-char truncation, "…[truncated]" marker
});

const statusIcon = computed(() => {
  if (props.status === "error") return "pi-times-circle";
  if (props.status === "done") return "pi-check-circle";
  if (props.status === "unknown") return "pi-question-circle";
  return "pi-spin pi-spinner";
});
const statusIconStyle = computed(() => {
  if (props.status === "error") return { color: "#dc2626" };
  if (props.status === "done") return { color: "#16a34a" };
  return undefined;
});
```
- Slot props: `CopilotChatToolCallRenderSlotProps = { name, args, status: "inProgress"|"executing"|"complete", result, toolCall, toolMessage }`. Map `inProgress/executing → pending spinner`, `complete → done` (error detection: `result` content inspection only — RESEARCH Pitfall 3; `status` is "complete" for errored calls too).
- Args display: `formatToolSubject(subject, 80)` (toolCallDisplay.ts:12-17) — 80ch truncation with `…`; primary arg from `args` (command for bash/run tools).
- Body: `<pre class="tc__output">` styled per ToolCallBlock.vue:236-246 (mono, pre-wrap, max-height 240px, `--p-text-color`).
- **IMPORTANT:** dispatch on `name` + args shape only — the wire carries NO `display.contentType` hint (`event-bridge.ts:174-180`); args arrive as one full-JSON delta, not chunked.

**Status palette:** running `--p-blue-500`, done `--p-green-500`, error #dc2626 (`ToolCallBlock.vue:102-106`); dark-mode block via `html.dark-mode` global style (ToolCallBlock.vue:264-293 pattern).

---

### `src/mainview/components/chat/tool-call-renderers/FileChangesRenderer.vue` (NEW — renderer, transform)

**Analog:** `ToolCallBlock.vue` diffPayloads branch (lines 20-31) + `FileDiff.vue` + `ReadView.vue`.

**Dispatch (from RESEARCH Pattern 2):** read family (`read|read_file|view`) → ReadView body; write/edit/apply_patch families → FileDiff payloads. Compute per-file stats in the header:
```typescript
const totalAdded = computed(() =>
  (props.diffPayloads ?? []).reduce((sum, p) => sum + (p.added ?? 0), 0),
);
const totalRemoved = computed(() =>
  (props.diffPayloads ?? []).reduce((sum, p) => sum + (p.removed ?? 0), 0),
);
```
(`ToolCallBlock.vue:108-113`; render as `+N`/`−N` stat chips, CSS lines 205-222.)

**Diff body** — reuse `FileDiff.vue` structure verbatim (import from `../FileDiff.vue` like ToolCallBlock.vue:54-55 does): rename `from→to` simple row (FileDiff.vue:3-9), hunk groups with `@@ -old +new @@` sticky headers (21-35), load-more windowing `CAP=50/CHUNK=25` (55-131), line backgrounds `#e6ffed`/`#ffeef0` + dark variants (242-244, 289-290).

**File body** — reuse `ReadView.vue` (lines 32-70): `CAP=50/CHUNK=25` line windowing, gutter + content rows, load-more up/down.

---

### `src/mainview/components/chat/tool-call-renderers/DelegateSummaryRenderer.vue` (NEW — renderer, transform)

**Analog:** `SubagentBlock.vue` (port source).

**Core pattern** (SubagentBlock.vue:1-45): collapsible header (chevron + status icon + intent), `details`/`summary` "Prompt" section, result markdown. Copy:
```vue
<template>
  <div :class="['sa', { 'sa--done': done, 'sa--error': isError }]">
    <button class="sa__header" @click="open = !open">
      <i :class="['pi', open ? 'pi-chevron-down' : 'pi-chevron-right', 'sa__chevron']" />
      <span v-if="!done" class="sa__spinner"><i class="pi pi-spin pi-spinner sa__status-icon sa__status-icon--running" /></span>
      <i v-else-if="isError" class="pi pi-times-circle sa__status-icon sa__status-icon--error" />
      <i v-else class="pi pi-check-circle sa__status-icon sa__status-icon--done" />
      <span class="sa__intent">{{ intent }}</span>
    </button>
    <div v-if="open" class="sa__body">
      <details class="sa__prompt-details">
        <summary class="sa__prompt-summary">Prompt</summary>
        <div class="sa__prompt prose" v-html="renderMd(prompt)" />
      </details>
      <div v-if="done && result" class="sa__result prose" v-html="renderMd(result)" />
    </div>
  </div>
</template>
```
- `intent`/`prompt` come from `args` (`args.intent`, `args.prompt`); `result` from slot prop.
- `renderMd` via `useMarkdown()` (`useMarkdown.ts:14-16` — `marked.parse(content, { async: false, breaks: true, gfm: true })`). Nested child tool calls collapse inside with count badge (ToolCallBlock.vue:10-16 `tc__badge` + `children` recursion pattern).
- CSS: `.sa__*` block (SubagentBlock.vue:71-213) + dark-mode global block (186-213) — port verbatim.

---

### `src/mainview/composables/useCommandsCache.ts` (MODIFY — composable, request-response)

**Analog:** itself — add the session path + toolsMenu mapping helper.

**Existing cache pattern to extend** (useCommandsCache.ts:20-80): module-level `cache` Map + `commandRefs` Map, `getCommands(taskId)` (fetch + TTL 30min + background revalidate), `getCommandsRef(taskId)`. Add a `workspaceKey` variant for sessions — `engine.listCommands` accepts `{ taskId?: number; workspaceKey?: string }` (`rpc-types.ts:991-994`).

**toolsMenu mapping (CHAT-06)** — RESEARCH.md lines 361-371 (verified `ToolsMenuItem` type): 
```typescript
import { getCommandsRef } from "../composables/useCommandsCache";
import type { ToolsMenuItem } from "@copilotkit/vue/v2";
const menu = computed<ToolsMenuItem[]>(() =>
  (taskId != null ? getCommandsRef(taskId).value : sessionCommands.value).map((c) => ({
    label: `/${c.name}`,
    action: () => { inputValue.value += `/${c.name}`; },   // ref must be the entire leading value (AGENTS.md)
  })),
);
```
Extract this mapping as a pure exported function (e.g. `toToolsMenu(commands: CommandInfo[]): ToolsMenuItem[]`) so it is unit-testable — mirror the pure-helper precedent of `utils/decisionRequest.ts`.

---

### `src/mainview/App.vue` (MODIFY — provider mount)

**Analog:** none in repo — use RESEARCH.md lines 283-295 (verified). Wrap `<RouterView />` (line 4) in `<CopilotKitProvider runtime-url="/api/copilotkit">`. **Do NOT remove** the existing WS push registration (lines 44-99): `onStreamError`/`onStreamEventMessage`/`onTaskUpdated`/`onNewMessage`/`onCodeRef`/`onChatSessionUpdated` handlers stay live for board/session chrome (UI-04). The `/ws` dispatch in `rpc.ts:90-103` is untouched.

### `src/mainview/main.ts` (MODIFY — global CSS)

**Analog:** itself. Add `import "@copilotkit/vue/styles.css";` beside the existing CSS imports (`main.ts:7-8` — `primeicons/primeicons.css`, `@xterm/xterm/css/xterm.css`). Import ONCE; verify board layout after (RESEARCH Pitfall 4).

### `src/mainview/views/BoardView.vue` (MODIFY — view)

**Swap site:** `BoardView.vue:210-213` — replace `<ChatSidebar v-if="chatSidebarOpen" @close="...">` with `<ChatThreadSidebar>` (same v-if/close contract; import swap at line 268). Toggle button + badge (lines 85-97) and the `activeChatSessionId` watch (line 745) stay.

### `src/mainview/components/TaskChatView.vue` (MODIFY — view)

**Swap site:** Chat tab branch lines 118-177. Replace `<ConversationBody>` (120-129) + `<ConversationInput>` (149-176) with `<RailyinChat :thread-id="String(task.conversationId)" title="..." />` inside the same `v-if="activeTab === 'chat' && task"` branch. KEEP: `ChangedFilesPanel` (132-138), `TodoPanel` (141-146), header/toolbar chrome (lines 3-115). Keep `defineExpose({ scrollToBottom, scheduleScrollToBottomIfAuto })` (542-545) — ConversationDrawer still calls these (ConversationDrawer.vue:50-51, 70-72); RailyinChat can expose no-ops or let CopilotChat own scroll (RESEARCH: CopilotChat `autoScroll` prop).

### `src/mainview/components/SessionChatView.vue` (MODIFY — view)

**Swap site:** Chat tab branch lines 74-128. Replace `<ConversationBody>` (75-85) + `<ConversationInput>` (101-128) with `<RailyinChat :thread-id="String(session.conversationId)">` (session thread = no taskId → commands menu uses the new `workspaceKey` path). Keep the loading spinner pattern (57-59) for `messagesLoading` or switch to CopilotChat `isConnecting`. Keep Decisions/Notes tabs (87-98).

### `e2e/ui/fixtures/mock-agui.ts` (MODIFY — test fixture)

**Analog:** itself — extend the `install()` route dispatch (mock-agui.ts:80-135) with two new branches BEFORE the 404 fallthrough:
```typescript
// POST /api/copilotkit/agent/:agentId/connect → SSE replay body
//   (mirror railyin-runner replay shape: RUN_STARTED + historic events + synthesized
//   TOOL_CALL_RESULTs + MESSAGES_SNAPSHOT + RUN_FINISHED; never-run thread → empty 200 SSE, RUNR-06)
if (route.request().method() === "POST" && /^\/api\/copilotkit\/agent\/[^/]+\/connect$/.test(path)) {
  const sseBody = buildConnectReplaySseBody(threadId);   // new builder next to buildQuickRunSseBody (65-71)
  await route.fulfill({ status: 200, contentType: MOCK_AGUI_SSE_HEADERS["content-type"],
    headers: { "cache-control": MOCK_AGUI_SSE_HEADERS["cache-control"] }, body: sseBody });
  return;
}
// POST /api/copilotkit/agent/:agentId/stop/:threadId → { success: true }
```
- Reuse `EventEncoder` framing + `MOCK_AGUI_SSE_HEADERS` (36-39) + `RunAgentInputSchema.parse` (66) — never hand-roll frames.
- Reuse `buildQuickRunEvents` (`e2e/api/copilotkit/probe-agent.ts:36-44`) as the base for the connect replay event list.

### `e2e/ui/fixtures/index.ts` (MODIFY — fixture wiring)

**Analog:** itself — add `MockAgui` as an auto-use fixture for the NEW specs only (legacy specs untouched):
```typescript
import { MockAgui } from "./mock-agui";
// in base.extend<Fixtures>:  agui: [async ({ page }, use) => {
//   const agui = new MockAgui(page);
//   await agui.install();      // safe before/after api.install() — ApiMock route.fallback() (mock-api.ts:95-98)
//   await use(agui);
// }, { auto: true }],
```
Install-order safety is already handled: `ApiMock` hands `/api/copilotkit/*` to `route.fallback()` (mock-api.ts:95-98).

### `e2e/ui/chat-copilotkit.spec.ts` (NEW — e2e test)

**Analog:** `e2e/ui/extended-chat.spec.ts` structure (lines 10-61): `import { test, expect } from "./fixtures"`, helper imports from `./fixtures` (`openTaskDrawer`, `sendMessage`), `api.handle(...)` + `ws.push(...)` for orchestration, `page.goto("/")` then open drawer. New specs use the `agui` fixture instead of ws pushes for chat traffic. Test ids from UI-SPEC: `chat-input`, `stop-btn`, `thread-item-{id}`, `thread-new`, `legacy-import-btn`, `decision-card`, `decision-submit`, `tool-card-{toolCallId}`; default card renders `data-testid="copilot-tool-render"`.

### Unit tests (NEW — test)

**Analog:** `src/mainview/utils/decisionRequest.test.ts` (pure helper tests) + `src/mainview/composables/useCommandsCache.test.ts`. Cover: toolsMenu mapping pure fn, `ShellOutputRenderer`/`FileChangesRenderer`/`DelegateSummaryRenderer` (truncation, stats, details), DecisionInterrupt payload mapping (`DecisionRequestState` → resume payload), family-name → slot-name mapping (RESEARCH Pitfall 1).

---

## Shared Patterns

### CSS / design tokens
**Source:** every legacy chat component (ChatSidebar.vue, ToolCallBlock.vue, SubagentBlock.vue, DecisionRequest.vue, FileDiff.vue, ReadView.vue) + `ConversationDrawer.vue:143-177` for third-party overrides.
**Apply to:** all new chat components.
- Two-block style pattern: `<style scoped>` for own layout + `<style>` global `html.dark-mode` overrides for palette colors that don't flip via PrimeVue variables (ToolCallBlock.vue:264-293, MessageBubble.vue:437-443, DecisionRequest.vue:535-597).
- `--p-*` tokens ONLY (UI-SPEC token contract), except ported badge hexes (weight badges, diff tags, status icon colors).
- Markdown parity `:deep` rules: ConversationBody.vue:608-627 (p/h1-h4/ul/ol/li/code/pre) + MessageBubble.vue:316-350 (blockquote/table/hr/a).

### Dark mode
**Source:** `html.dark-mode` class on `<html>` (main.ts:21 `darkModeSelector: ".dark-mode"`, localStorage `railyn-dark-mode`). All new components must ship both blocks.

### data-testid conventions
**Source:** UI-SPEC Component Inventory test ids; existing precedent `data-testid="queue-chips"` (ConversationInput.vue:7). Apply to all new components.

### Pinia store pattern
**Source:** `stores/conversation.ts:92-448`, `stores/chat.ts:11-332` — setup-store style (`defineStore("x", () => {...})`), `api()` typed calls from `rpc.ts:20-37`. **Boundary:** RailyinChat reads NO message state from these stores; it only consumes `task.conversationId` / `session.conversationId` as the `threadId` prop.

### Composable pattern
**Source:** `useCommandsCache.ts` (module-level cache + `Ref` sharing), `useMarkdown.ts` (returns `{ renderMd, renderUserMd }`), `useToolResultDisplay.ts` (computed from a prop ref). Ported renderers consume `useMarkdown`/`useToolResultDisplay` as-is.

### E2E mock conventions
**Source:** `mock-api.ts` (handle/returns/delayed/capture + loud 501), `mock-ws.ts` (push), `mock-agui.ts` (SSE framing via `EventEncoder`, `buildQuickRunEvents`). New specs mock ALL backend via `page.route()` — never a real Bun server.

---

## No Analog Found

| File | Role | Data Flow | Reason / Source |
|------|------|-----------|-----------------|
| `src/mainview/components/chat/RailyinChat.vue` (CopilotChat surface) | component | streaming | No CopilotKit usage exists in the repo yet. Use RESEARCH.md verified code examples (lines 283-346) + ConversationDrawer's non-scoped override pattern for CSS. All API claims already verified against installed `@copilotkit/vue@1.66.4` + `@ag-ui/client@0.0.57`. |
| `src/mainview/App.vue` (provider mount) | root | — | Same — use RESEARCH.md provider example (lines 283-295); no license keys. |

## Metadata

**Analog search scope:** `src/mainview/` (components, views, composables, stores, utils, rpc), `src/shared/rpc-types.ts`, `e2e/ui/fixtures/`, `e2e/api/copilotkit/`, `.planning/phases/03-decision-interrupts-resume/`
**Files scanned:** 25 (23 read fully, 2 grepped for targeted sections — BoardView.vue, ConversationInput.vue)
**Pattern extraction date:** 2026-08-09
