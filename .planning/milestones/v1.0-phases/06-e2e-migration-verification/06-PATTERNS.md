# Phase 6: E2E Migration & Verification - Pattern Map

**Mapped:** 2026-08-09
**Files analyzed:** 29 (25 red spec files + mock-agui.ts, mock-agui.test.ts, helpers.ts, mock-api.ts, mock-data.ts, index.ts, playwright.config.ts, chat-copilotkit.spec.ts)
**Analogs found:** 28 / 29 (the 11 whole-file retires are deletions — pattern is "retire-with-rationale", not a code analog)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `e2e/ui/chat.spec.ts` | test (migrate) | streaming (agui fixture) | `e2e/ui/chat-copilotkit.spec.ts` | exact |
| `e2e/ui/chat-session-drawer.spec.ts` | test (migrate 19 + retire 7 in-file) | streaming + history replay | `e2e/ui/chat-copilotkit.spec.ts` | exact |
| `e2e/ui/extended-chat.spec.ts` | test (migrate 3 + retire ~16 in-file) | streaming + stop | `e2e/ui/chat-copilotkit.spec.ts` | exact |
| `e2e/ui/delegate-rendering.spec.ts` | test (migrate 5) | streaming (toolcall) | `e2e/ui/chat-copilotkit.spec.ts` T-2 | exact |
| `e2e/ui/conversation-body.spec.ts` | test (migrate 2 + retire 2 in-file) | streaming + history replay | `e2e/ui/chat-copilotkit.spec.ts` C-2/T-2 | exact |
| `e2e/ui/autocomplete.spec.ts` | test (migrate ~12 + retire ~22 in-file) | request-response (slash menu) | `e2e/ui/chat-copilotkit.spec.ts` C-3 | exact |
| `e2e/ui/interview-me.spec.ts` | test (migrate 23) | event-driven (interrupt) | `e2e/ui/chat-copilotkit.spec.ts` C-4/C-5 | exact |
| `e2e/ui/timeline-pipeline.spec.ts` | test (migrate ~6 + retire ~4 in-file) | streaming | `e2e/ui/chat-copilotkit.spec.ts` S-1/C-2 | exact |
| `e2e/ui/stream-reactivity.spec.ts` | test (migrate ~13 + retire 2 in-file) | streaming + scroll | `e2e/ui/chat-copilotkit.spec.ts` S-1 | exact |
| `e2e/ui/tool-rendering.spec.ts` | test (migrate 13) | streaming (toolcall) | `e2e/ui/chat-copilotkit.spec.ts` T-1/T-2/T-3 | exact |
| `e2e/ui/cursor.spec.ts` | test (migrate 3 + retire 4 in-file) | streaming | `e2e/ui/chat-copilotkit.spec.ts` S-1 | exact |
| `e2e/ui/task-drawer.spec.ts` | test (migrate 3 + retire 3 in-file) | streaming + history replay | `e2e/ui/chat-copilotkit.spec.ts` S-2/C-1 | exact |
| `e2e/ui/conversation-stream-state.spec.ts` | test (migrate 2) | streaming (thread isolation) | `e2e/ui/chat-copilotkit.spec.ts` S-1/S-2 | exact |
| `e2e/ui/code-server.spec.ts` | test (retire CS-D-1..5 in-file) | — (deletion of 5 tests) | retire-with-rationale pattern | n/a |
| `e2e/ui/queue-messages.spec.ts` | test — DELETE whole file | — | retire-with-rationale pattern | n/a |
| `e2e/ui/model-persistence.spec.ts` | test — DELETE whole file | — | retire-with-rationale pattern | n/a |
| `e2e/ui/reasoning-mode-select.spec.ts` | test — DELETE whole file | — | retire-with-rationale pattern | n/a |
| `e2e/ui/attachment-history.spec.ts` | test — DELETE whole file | — | retire-with-rationale pattern | n/a |
| `e2e/ui/mcp-tools.spec.ts` | test — DELETE whole file | — | retire-with-rationale pattern | n/a |
| `e2e/ui/conversation-pagination.spec.ts` | test — DELETE whole file | — | retire-with-rationale pattern | n/a |
| `e2e/ui/sampling-preset-select.spec.ts` | test — DELETE whole file | — | retire-with-rationale pattern | n/a |
| `e2e/ui/compact-button.spec.ts` | test — DELETE whole file | — | retire-with-rationale pattern | n/a |
| `e2e/ui/transition-card-legacy.spec.ts` | test — DELETE whole file | — | retire-with-rationale pattern | n/a |
| `e2e/ui/conversation-draft.spec.ts` | test — DELETE whole file | — | retire-with-rationale pattern | n/a |
| `e2e/ui/model-picker-multi-engine.spec.ts` | test — DELETE whole file | — | retire-with-rationale pattern | n/a |
| `e2e/ui/fixtures/mock-agui.ts` | fixture/utility (EXTEND) | event-driven (SSE builders) | itself — `buildConnectReplaySseBody` (mock-agui.ts:297-361) | exact (same file, smallest extension) |
| `e2e/ui/fixtures/mock-agui.test.ts` | test (EXTEND) | — | itself — `describe("buildConnectReplaySseBody", ...)` (mock-agui.test.ts:36-99) | exact |
| `e2e/ui/fixtures/helpers.ts` | utility (ADD 3 helpers) | request-response | `chat-copilotkit.spec.ts:31-59` (inline helpers being extracted) + `helpers.ts:8-23` (file conventions) | exact |
| `e2e/ui/fixtures/index.ts` | fixture wiring (ADD re-exports) | — | itself — export line 144-145 | exact |
| `playwright.config.ts` | config (conditional) | — | itself — testMatch lines 25-26 | exact |

## Pattern Assignments

### The canonical analog — `e2e/ui/chat-copilotkit.spec.ts` (15/15 green, 478 lines)

**Applies to:** ALL 13 migrate files. This is the migration template (RESEARCH Pattern 1). **FROZEN — never edit it during Phase 6** (Pitfall 8); helper extraction is a separate task.

**Imports pattern** (lines 24-27):
```typescript
import { test, expect } from "./fixtures";
import { openTaskDrawer, openSidebar } from "./fixtures";
import { makeTask, makeChatSession } from "./fixtures/mock-data";
import type { Page } from "@playwright/test";
```

**Helper pattern** (lines 31-59 — to be extracted verbatim into `fixtures/helpers.ts`):
```typescript
/** The CopilotChatInput textarea inside our #input slot wrapper. */
function chatTextarea(page: Page) {
    return page.locator('[data-testid="chat-input"] textarea');
}

/** Track POSTs to /agent/default/connect ... threadId arrives in the request BODY */
function collectConnectRequests(page: Page): string[] {
    const requests: string[] = [];
    page.on("request", (req) => {
        if (req.method() === "POST" && /\/agent\/default\/connect$/.test(new URL(req.url()).pathname)) {
            try {
                const body = JSON.parse(req.postData() ?? "{}") as { threadId?: unknown };
                if (typeof body.threadId === "string") requests.push(body.threadId);
            } catch { /* Malformed body — ignore */ }
        }
    });
    return requests;
}

async function submitChatMessage(page: Page, text: string): Promise<void> {
    const input = chatTextarea(page);
    await input.click();
    await input.pressSequentially(text);
    await page.keyboard.press("Enter");
}
```

**Operation patterns to copy** (each maps one migrated intent family):

**1. Streaming via /run** (S-1, lines 63-83) — never-run thread (NO `registerThread`) so the ONLY "hello" source is the /run stream:
```typescript
const t = makeTask({ id: 101, conversationId: 101, title: "Streaming Task" });
api.handle("tasks.list", () => [t]);
await page.goto("/");
await openTaskDrawer(page, t.id);
const chat = page.locator('[data-testid="copilot-chat-view"]');
await expect(chat).toBeVisible({ timeout: 10_000 });
await submitChatMessage(page, "stream this please");
await expect(chat).toContainText("stream this please", { timeout: 10_000 });
await expect(chat).toContainText("hello", { timeout: 10_000 }); // quick-script text
```
→ Replaces `api.handle("tasks.sendMessage")` + `api.handle("conversations.getMessages")` + `ws.pushStreamEvent(...)` (legacy: chat.spec.ts:43-56, timeline-pipeline.spec.ts:55, conversation-body.spec.ts:72-73, stream-reactivity.spec.ts:71).

**2. History replay on reopen** (S-2, lines 85-110) — `registerThread` + collectConnectRequests; close via Escape, reopen, expect connect ≥2 and contains threadId:
```typescript
agui.registerThread(String(t.conversationId));
const connectRequests = collectConnectRequests(page);
// ... open, Escape, reopen ...
expect(connectRequests.length).toBeGreaterThanOrEqual(2);
expect(connectRequests).toContain(String(t.conversationId));
```
→ Replaces `conversations.getMessages` hand-stubbed history (legacy: chat.spec.ts:238-256 O-9, task-drawer.spec.ts TD-5/6). For multi-message ORDER intents (chat O-10, CD-E-1, TD-5/6), use the new `registerHistory` knob (see MockAgui extension below) and assert nth-message order in `copilot-chat-view`.

**3. Stop mid-run** (C-1, lines 237-265) — `agui.script = "slow"`; assert on deterministic `agui.stopRequests`, not timing:
```typescript
agui.script = "slow";
await submitChatMessage(page, "start something long");
const stopBtn = page.locator('[data-testid="stop-btn"]');
await expect(stopBtn).toBeVisible({ timeout: 5_000 });
await stopBtn.click();
const stopped = page.locator('[data-testid="chat-stopped"]');
await expect(stopped).toBeVisible({ timeout: 10_000 });
await expect(stopped).toContainText("Stopped");
expect(agui.stopRequests).toContain(String(t.conversationId));
```
→ Replaces `.task-detail__input .pi-stop-circle` assertions (legacy: chat.spec.ts N-6:150-169, extended-chat P-12/13/14).

**4. Reasoning card** (C-2, lines 267-286) — `agui.script = "reasoning"`; `[data-message-id="r1"]` collapsed `Thinking…|Thought for`, expand via first button:
```typescript
agui.script = "reasoning";
await submitChatMessage(page, "why?");
const reasoningCard = page.locator('[data-message-id="r1"]');
await expect(reasoningCard).toBeVisible({ timeout: 10_000 });
await expect(reasoningCard).toContainText(/Thinking…|Thought for/);
await reasoningCard.locator("button").first().click();
await expect(reasoningCard).toContainText("Comparing two candidate designs");
```
→ Replaces `.rb`/`.rb__content` (legacy: conversation-body.spec.ts CB-1/CB-1b:68-109, timeline-pipeline T-29/T-32).

**5. Slash menu** (C-3, lines 288-310) — `api.handle("engine.listCommands", ...)`; type "/" → `[data-testid="copilot-slash-menu"]` + `[role="option"]`:
```typescript
api.handle("engine.listCommands", () => [{ name: "fake-cmd", description: "d" }]);
const input = chatTextarea(page);
await input.click();
await input.pressSequentially("/");
const slashMenu = page.locator('[data-testid="copilot-slash-menu"]');
const option = slashMenu.locator('[role="option"]', { hasText: "/fake-cmd" });
await option.click();
await expect(input).toHaveValue("/fake-cmd");
```
→ Replaces `.cm-tooltip-autocomplete` (legacy: autocomplete.spec.ts AC-1/2/3/10/11/12/16/21/22/25/29/30).

**6. Tool cards** (T-1/T-2/T-3, lines 158-232) — `agui.script = "toolcall"`; testids `copilot-tool-render` (generic), `tool-card-tc-bash` (shell), `tool-card-tc-sub` (delegate), `tool-card-tc-write` (file); expand via `locator("button").first()`; replay-completed via `registerThread` + `.pi-check-circle` present, no `.pi-spinner`:
```typescript
agui.script = "toolcall";
await submitChatMessage(page, "run it");
const bashCard = page.locator('[data-testid="tool-card-tc-bash"]');
await expect(bashCard).toContainText("ls -la");
await bashCard.locator("button").first().click();
await expect(bashCard).toContainText("total 8");
```
→ Replaces `.tc`/`.delegate-divider`/`.tc__tool-name` (legacy: tool-rendering.spec.ts all, delegate-rendering.spec.ts all 5, conversation-body CB-3).

**7. Decision interrupt** (C-4/C-5, lines 312-385) — `agui.script = "interrupt"`; `[data-testid="decision-card"]` + `.di__option`; flip `agui.script = "quick"` before `[data-testid="decision-submit"]`; assert resume payload:
```typescript
agui.script = "interrupt";
await submitChatMessage(page, "decide this");
const decisionCard = page.locator('[data-testid="decision-card"]');
await decisionCard.locator(".di__option", { hasText: "Yes, apply them" }).click();
await decisionCard.locator(".di__option", { hasText: "Fail loudly" }).click();
agui.script = "quick";
await page.locator('[data-testid="decision-submit"]').click();
await expect.poll(() => (agui.lastRunInput as { resume?: unknown[] } | null)?.resume?.length ?? 0, { timeout: 10_000 }).toBeGreaterThan(0);
expect((agui.lastRunInput as any).resume[0].interruptId).toBe("decision-interrupt-1");
expect((agui.lastRunInput as any).resume[0].payload.answers.length).toBeGreaterThan(0);
```
→ Replaces `decision_request_prompt` ws flow + `decisions.submit` RPC assertions (legacy: interview-me.spec.ts T-A..Q, extended-chat S-1..3, cursor CU-4). **Verified DecisionInterrupt surface:** `decision-card` testid, `.di__option` rows, Other freetext row, `.di__textarea--notes` notes, `recordAsDecisions` checkbox, `decision-submit` (DecisionInterrupt.vue:37-122, 122).

**8. Error state** (E-2, lines 132-153) — `agui.script = "error"`; `[data-testid="chat-error-row"]` + `.p-toast`:
```typescript
agui.script = "error";
await submitChatMessage(page, "trigger the failure");
const errorRow = page.locator('[data-testid="chat-error-row"]');
await expect(errorRow).toContainText("Execution failed: simulated failure");
await expect(page.locator(".p-toast")).toContainText("Execution failed", { timeout: 5_000 });
```

**Empty state** (E-1, lines 116-130) — never-run thread → `[data-testid="chat-empty-state"]` + enabled textarea.

---

### Per-file migration maps (13 migrate files)

For each: legacy anchors to delete/replace, and the exact canonical test to copy. All use the import block + helpers from the canonical analog. Migrated suites keep file names; new suite letters are planner's discretion (Open Question 3).

| Migrate file | Legacy anchors (verified) | New pattern → copy from | In-file retires |
|---|---|---|---|
| `chat.spec.ts` (12) | `sendMessage` helper (CodeMirror), `.msg--user` M-1 (40-57), `.msg__bubble.streaming` M-2 (59-78), `ws.pushStreamEvent` M-3/4 (80-121), `.pi-stop-circle` N-6 (150-169), `queue-btn` N-9 (200-232), `.conversation-inner .msg` order O-10 (258-279) | M→S-1; N-5/7→S-1 + keep `[data-task-id]` exec-* class asserts (board surface, untouched); N-6→C-1; N-9 editor-half→S-1 `chatTextarea` enabled; O-9/11→S-2; O-10→S-2 + `registerHistory` | N-9 queue-button half |
| `chat-session-drawer.spec.ts` (26) | `typeInSessionEditor` (helpers.ts:45-54 — KEEP byte-identical for green files), `.session-chat-view .conv-body` (394-399), `status_chunk` (419-433), scroll (607-626) | B/C/D-3/E-1/E-4/J-1/L-1/A-4 → S-1/S-2/C-1 + session variants of `chatTextarea`/`submitChatMessage` on `.session-chat-view`; E-4 scroll→S-2 + `registerHistory` + CopilotChat scroll container | A-6, G-1..3, H-2 (model selector), D-6 (submitDecisions→covered by C-4 resume), K-1/K-2 (file chips) |
| `extended-chat.spec.ts` (19) | `ws.pushStreamEvent` textChunk (40,70,125,198,393), `decision_request_prompt` ws flow S-1..3 (413-518) | P-12/13/14→C-1; streaming intents→S-1 | P-15, Q-16..20 (model selector), R-20..25+23 (compaction), S-1..3 (→C-4/C-5) |
| `delegate-rendering.spec.ts` (5) | `.delegate-divider` S-D1 (124-134), `.delegate-divider__label` S-D2 (136-145), `.msg--assistant` digest S-D3 (147-156), `.tc` count S-D4/S-D5 (158-217), `serial` mode (line 18), `makeDelegateMessages` seed (27-120) | All 5→T-2 `tool-card-tc-sub` (intent "Write the auth module" + markdown result); drop `test.describe.configure({ mode: "serial" })` (Pitfall 4 — route clobbering gone with per-test agui fixture) | — |
| `conversation-body.spec.ts` (5) | `ws.pushStreamEvent` reasoning/text (72-73), `.rb`/`.rb__content`/`.msg__bubble.streaming` CB-1/1b (75-109), `.conv-body .tc` CB-3 (133-149), `.transition-card`/`.msg--prompt` CB-4 (151-179) | CB-1/CB-1b→C-2 (reasoning script); CB-3→T-2 (toolcall script) | CB-2 (virtualization), CB-4 (transition cards) |
| `autocomplete.spec.ts` (34) | `.cm-tooltip-autocomplete` (slash), `.cm-content` chips | AC-1/2/3/10/11/12/16/21/22/25/29/30 → C-3 + editor-behavior asserts on `[data-testid="chat-input"] textarea` | AC-4..9, 13..15, 17..20, 23, 24, 26..28, 31..34 (CodeMirror chips/#/@/LSP + attachments) |
| `interview-me.spec.ts` (23) | `decision_request_prompt` message seeds (42, 302), T-J streaming flow (405+), Decisions-tab tests (6 stay) | T-A..Q → C-4/C-5 (interrupt script); notes/recordAsDecisions intents → DecisionInterrupt `.di__textarea--notes` + checkbox; submitDecisions RPC asserts → `agui.lastRunInput.resume` payload asserts | — (23 migrate, 6 stay) |
| `timeline-pipeline.spec.ts` (21) | `ws.pushStreamEvent` mkEvent text/reasoning (55,65,76,89-91,102-103,132,157,163), `status_chunk` T-34/36 (117-149) | T-28/30/31/33/35→S-1 (quick), T-29/32→C-2 (reasoning), T-35→S-1 | T-34/36 (status_chunk — trimmed), compaction/transition events |
| `stream-reactivity.spec.ts` (17) | `ws.pushStreamEvent` textChunk floods (71, 372-383, 429-470, 507-538, 627, 712, 773, 824, 847-861), `toolCallEvent` (85, 112) | A-1..3, C-1/2, E-1..7 (autoscroll), F-1, G-1/2 → S-1 (quick) + CopilotChat scroll container (`.railyn-chat` — replace `.conv-body` scroll asserts); G writtenFiles stats → `tool-card-tc-write` +N/−N (T-2) | B-2 (data-stream-version), F-2 (status_chunk); B-1/D-1 stay |
| `tool-rendering.spec.ts` (13) | `writtenFiles` seeds (78-104, 269-282, 345, 521, 568), `.tc`, `.fdiff__body` | All → T-1/T-2/T-3 (toolcall script): S-25 rawDiff → `tool-card-tc-write` (FileChangesRenderer dispatch, verified FileChangesRenderer.vue:15); S-26/31 subagent → `tool-card-tc-sub`; S-27 stale → T-3 (registerThread replay-completed); S-29..33 cursor-family → generic quick script (model-agnostic) | — |
| `cursor.spec.ts` (7) | `decision_request_prompt` seed (89), `ws.pushStreamEvent` (162-164), CU-4 interview UI (218-230) | CU-2.1/3.1/4.1 render intents → S-1/C-4 (model-agnostic scripts) | CU-1.1/1.2 + picker tests (model picker removed) |
| `task-drawer.spec.ts` (6) | `.task-chat-view .conv-body` scroll asserts (66-74), `conv-body__tail` (107-112), `[data-index]` order (110-112), `msg--user` (256-257) | MSG-1 (send without reopen) → S-1; TD-5/6 (latest message + ordered history) → S-2 + `registerHistory` | TD-2 (toolbar chrome), TD-3 (attachment chip), TD-7 (transition cards); TD-1/4/8 stay |
| `conversation-stream-state.spec.ts` (2) | — | SS-1/SS-2 (cross-thread isolation) → S-1 twice with two threadIds + per-thread `registerHistory` (threadId-switch pattern, WR-02); SS-3 stays | — |

---

### `e2e/ui/fixtures/mock-agui.ts` (EXTEND — multi-message history knob)

**Analog:** the file itself. The ONLY change: thread a `historyMessages` knob through `buildConnectReplaySseBody`. Do NOT touch the /run route branch, `registerThread`, `stopRequests`, or the `script` dispatch (mock-agui.ts:408-536) — green specs depend on them (Pitfall 3).

**Extension point** (lines 297-361) — the snapshot is currently hardcoded:
```typescript
export function buildConnectReplaySseBody(
  threadId: string,
  script: RunScript = "quick",
  knownThreadIds: ReadonlySet<string> = new Set(),
): string {
    if (!knownThreadIds.has(threadId)) {
        return "";
    }
    // ...
    const snapshotMessages =
        script === "toolcall" ? [ /* ... */ ]
        : interruptReplay ? [{ id: "m1", role: "assistant", content: "What do you think?" }]
        : [{ id: "m1", role: "assistant", content: "hello" }];   // ← line 347: hardcoded single message
```

**Required change (RESEARCH Pattern 3):** add an optional `historyMessages?: Array<{ id: string; role: string; content?: string }>` parameter (default = today's behavior) that REPLACES the default snapshot (`: [{ id: "m1", role: "assistant", content: "hello" }]`) when provided. Add `registerHistory(threadId, messages)` to the class (lines 363-406) storing per-thread history next to `knownThreadIds`, passing it through the connect route branch (line 496). **Every frame still goes through `EventEncoder` + `patchRunStartedInput` — never hand-rolled frames** (mock-agui.ts:35, 56-61). The historic event sequence stays the quick sequence; only the snapshot grows.

Class pattern to extend (lines 363-406):
```typescript
export class MockAgui {
    script: RunScript = "quick";
    runInputs: unknown[] = [];
    lastRunInput: unknown = null;
    stopRequests: string[] = [];
    readonly knownThreadIds = new Set<string>();   // per-instance (WR-05) — new history map MUST also be per-instance
    constructor(page: Page) { this._page = page; }
    registerThread(threadId: string): this { this.knownThreadIds.add(threadId); return this; }
    async install(): Promise<void> { /* route handler */ }
}
```

**Verification rule:** the new knob is per-instance (like `knownThreadIds` — WR-05 test at mock-agui.test.ts:91-98 guards module-level leakage; mirror it for history).

### `e2e/ui/fixtures/mock-agui.test.ts` (EXTEND)

**Analog:** the file itself — pure-node tests, `bun:test`, no Playwright Page (header lines 1-16). Decode helpers at lines 22-34:
```typescript
import { describe, test, expect } from "bun:test";
import type { Page } from "@playwright/test";
import { EventType, type AGUIEvent } from "@ag-ui/core";
import { MockAgui, buildConnectReplaySseBody, /* ... */ } from "./mock-agui";

function decodeFrames(sseBody: string): AGUIEvent[] { /* split \n\n, strip data: , JSON.parse */ }
function typesOf(sseBody: string): EventType[] { /* decodeFrames().map(f => f.type) */ }
```

**New describe blocks to add** (mirroring `describe("buildConnectReplaySseBody", ...)` at lines 36-99): (1) history knob produces the provided messages in the snapshot (order preserved), (2) history knob defaults to `hello` when omitted (backward compat), (3) per-instance `registerHistory` isolation (WR-05 parity), (4) snapshot sits before the single terminal (types: `MESSAGES_SNAPSHOT` idx < last `RUN_FINISHED` idx — pattern at lines 52-66). **Pitfall 6: no fixture change without a self-test case.**

### `e2e/ui/fixtures/helpers.ts` (ADD — chat-surface helpers)

**Analog:** chat-copilotkit.spec.ts:31-59 (extraction source) + helpers.ts:8-23 (file conventions: `import type { Page } from "@playwright/test"`, JSDoc per export).

**Add** (verbatim from the canonical spec): `chatTextarea(page)`, `submitChatMessage(page, text)`, `collectConnectRequests(page)`. **DO NOT touch** `openTaskDrawer` (helpers.ts:12-15), `sendMessage` (helpers.ts:18-23 — CodeMirror-based, still used by green legacy specs; leave byte-identical per Pitfall 3), `openSidebar`/`openSessionDrawer`/`typeInSessionEditor`/`openSessionNotesTab`.

### `e2e/ui/fixtures/index.ts` (ADD re-exports)

**Analog:** export line 144-145:
```typescript
export { openTaskDrawer, sendMessage, openSidebar, openSessionDrawer, typeInSessionEditor, openSessionNotesTab } from "./helpers";
```
Add the three new helpers to this export list (or have migrated specs import from `./fixtures/helpers` directly — planner's call; the canonical spec imports helpers via `./fixtures`). Fixture setup (lines 41-142) is unchanged — `agui` auto-use fixture already installed (lines 52-56).

### `playwright.config.ts` (CONDITIONAL)

**Analog:** itself, lines 24-31:
```typescript
testDir: "e2e/ui",
testMatch: "**/*.spec.ts",
fullyParallel: true,
```
**Only if the planner chooses `e2e/ui/retired/` over deletion (Open Question 2):** add `testIgnore: "**/retired/**"` — otherwise retired specs still match `**/*.spec.ts` and run red. If retire = git deletion (recommended by RESEARCH Pitfall 7), **no config change**. Do not touch `fullyParallel`, `retries`, `workers`, `webServer`.

---

## Shared Patterns

### MockAgui script selection (applies to all 13 migrate files)

Source: mock-agui.ts:110-111, 376, 408-472 (verified). Set `agui.script` BEFORE `submitChatMessage`:

| Scenario | Fixture setup | Legacy construct replaced |
|----------|---------------|---------------------------|
| Basic streaming / error | `agui.script = "quick"` / `"error"` | `ws.pushStreamEvent(text_chunk)` |
| Stop mid-run | `agui.script = "slow"` (3s fulfill hold, no terminal) + assert `agui.stopRequests` | `.pi-stop-circle` + queue flow |
| Tool cards | `agui.script = "toolcall"` (tc-card generic, tc-bash, tc-sub, tc-write) | `.tc` cards + `writtenFiles` seeds |
| Reasoning card | `agui.script = "reasoning"` (`[data-message-id="r1"]`) | `.rb` / `.rb__content` |
| Decision interrupt | `agui.script = "interrupt"`, flip to `"quick"` before submit | `decision_request_prompt` ws + `decisions.submit` |
| History replay | `agui.registerThread(String(conversationId))`; never-run → empty body | `conversations.getMessages` stubs |
| Ordered multi-message history | NEW `agui.registerHistory(threadId, [...])` (Pattern 3 extension) | 4-message `getMessages` arrays |

### Legacy → new selector mapping (assertion rewrite table)

Source: RESEARCH Pattern 1 (all verified against RailyinChat.vue / renderers this session):

| Legacy (dead) | New (verified) |
|---------------|----------------|
| `.msg--user` / `.msg--assistant` | `[data-testid="copilot-chat-view"]` content + `[data-message-id]` rows |
| `.msg__bubble.streaming` | streaming text from `buildQuickRunEvents` ("hello") |
| `.rb` / `.rb__content` | `[data-message-id="r1"]` reasoning card (collapsed "Thinking…"/"Thought for") |
| `.tc` / `.tc__tool-name` / `.delegate-divider` | `[data-testid="tool-card-{toolCallId}"]` (tc-bash/tc-sub/tc-write) or `copilot-tool-render` |
| `.task-detail__input .pi-stop-circle` | `[data-testid="stop-btn"]` + `[data-testid="chat-stopped"]` |
| `.cm-content` (CodeMirror) | `[data-testid="chat-input"] textarea` (RailyinChat.vue:130) |
| `.cm-tooltip-autocomplete` | `[data-testid="copilot-slash-menu"]` + `[role="option"]` |
| `.conv-body` scroll container | CopilotChat's scroll container (`.railyn-chat` / chat view root) |
| `queue-btn`, `.input-model-select`, `.ctx-popover`, `.transition-card`, `.msg--prompt`, `.inline-chip-text__chip--file`, `.chat-editor__chip` | REMOVED — retire, no equivalent |

### Retire-with-rationale (11 whole-file + ~40 in-file)

**No code analog exists** — the pattern is a process. Verification BEFORE every deletion (RESEARCH Pattern 2, Pitfall 2):
```bash
# Example: model selector retirement — prove the feature exists ONLY in dead legacy code
rg -n "input-model-select|model-select__value" src/mainview/    # → only dead ConversationInput.vue:175
rg -n "ConversationInput" src/mainview/ --include="*.vue" -l    # → no live importer
```
Per-file retire rationale (one line: what it tested → where the feature went):

| Retired file | Subject → fate |
|---|---|
| `queue-messages.spec.ts` (25) | Queue UI → removed (UI-SPEC:140 "no queue affordance"); verified `queue-btn` only in dead ConversationInput.vue |
| `model-persistence.spec.ts` (10) | In-chat model selector → removed (`.input-model-select` only at ConversationInput.vue:175) |
| `reasoning-mode-select.spec.ts` (3+1) | Per-model reasoning selector → removed (ConversationInput.vue:290); thinkingFormat now engines.yaml config (AGENTS.md); covered by C-2 |
| `attachment-history.spec.ts` (3) | `[#ref\|label]` file chips → removed (CONT-01); only in dead MessageBubble/InlineChipText |
| `mcp-tools.spec.ts` (34) | MCP server popover → removed (only dead ConversationInput); MCP tool calls covered by T-1 default card |
| `conversation-pagination.spec.ts` (10) | Load-older sentinel → removed; full-history replay is v1 (PERF-01) |
| `sampling-preset-select.spec.ts` (8) | Preset selector → removed (per-model engines.yaml config, AGENTS.md) |
| `compact-button.spec.ts` (3) | Context ring + manual compact → removed (trim) |
| `transition-card-legacy.spec.ts` (2) | `.msg--prompt`/`transition_event` rendering → removed (trim) |
| `conversation-draft.spec.ts` (7) | CodeMirror draft persistence → removed (no draft props in CopilotChatInput.vue.d.ts — verified) |
| `model-picker-multi-engine.spec.ts` (5) | Engine-grouped picker → removed with legacy input; ManageModelsModal is a different surface |
| `code-server.spec.ts` CS-D-1..5 (in-file) | CodeRef chips (`.attachment-chip .ln__*`) → removed (only dead ConversationInput); CS-A/B/C (10 green) stay |

**Process rules:** each retire gated behind `checkpoint:human-verify` (irreversible); rationale recorded in plan + Phase 6 SUMMARY; commit message carries the rationale (Pitfall 7). If `e2e/ui/retired/` dir chosen over deletion → add `testIgnore` to playwright.config.ts (see above).

### Green-file protection (Pitfall 3, 8)

- `chat-copilotkit.spec.ts` — FROZEN (migration template + UI-01/CHAT-* regression set).
- `helpers.ts` legacy helpers — byte-identical; ADD only.
- `mock-api.ts` route.fallback contract (mock-api.ts:95-98) — fixed; no changes.
- `fixtures/index.ts` fixture setup (41-142) — unchanged; only the export line grows.
- Regression tripwire after every fixture change / wave merge: `npx playwright test e2e/ui/chat-copilotkit.spec.ts e2e/ui/board.spec.ts e2e/ui/board-ws-updates.spec.ts`.

### Don't hand-roll (RESEARCH table)

- SSE frames → `EventEncoder` (mock-agui.ts:35); run event sequences → `buildQuickRunEvents`/`buildToolCallRunEvents`/`buildInterruptRunEvents` from `e2e/api/copilotkit/probe-agent.ts:36`; snapshot merge → extend `buildConnectReplaySseBody` (Pattern 3); no new packages (zero-dep phase).

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| The 11 whole-file retire specs | test (deleted) | — | No code pattern to copy — they are the retirement subject; the applicable pattern is "retire-with-rationale" (process, above). Per-file rationale table covers each. |
| `playwright.config.ts` (if unchanged) | config | — | Conditional edit only; analog is itself. |

## Metadata

**Analog search scope:** `e2e/ui/` (all 53 spec files + fixtures), `playwright.config.ts`, `src/mainview/components/chat/` (RailyinChat.vue, DecisionInterrupt.vue, tool-call-renderers/), `e2e/api/copilotkit/probe-agent.ts`
**Files scanned:** 29 classified; 13 read in full (chat-copilotkit, chat.spec, delegate-rendering, conversation-body, queue-messages, mock-agui, mock-agui.test, mock-api, mock-data, helpers, index, playwright.config, CONTEXT/RESEARCH); grep-verified anchors in interview-me, stream-reactivity, timeline-pipeline, extended-chat, tool-rendering, cursor, task-drawer, chat-session-drawer, code-server
**Pattern extraction date:** 2026-08-09
