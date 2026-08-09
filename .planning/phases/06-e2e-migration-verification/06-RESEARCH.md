# Phase 6: E2E Migration & Verification - Research

**Researched:** 2026-08-09
**Domain:** Playwright E2E migration onto the AG-UI/CopilotKit mock fixture foundation; full-suite verification gate
**Confidence:** HIGH — every red/green claim below was verified by running the actual suites this session

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Migrate the expected-red legacy chat-surface specs (chat.spec.ts, chat-session-drawer, queue-messages, model-persistence, reasoning-mode-select, extended-chat, delegate-rendering, conversation-body, attachment-history, autocomplete) onto the new selectors/mocks — their old assertions target swapped-out legacy DOM (`.msg--user`, `.msg__bubble.streaming`, CodeMirror `.cm-content`, send-btn/queue-btn). Each migrated spec keeps its test intent but asserts against the new RailyinChat DOM + mock-agui fixtures.
- **D-02:** Migration is incremental, spec-by-spec: each migrated spec must pass against the mock foundation (mock-api + mock-agui, `/api/copilotkit/*` via page.route). The full suite must be green at the end (success criterion 2: all existing specs + new chat/board specs).
- **D-03:** Board-focused specs that never touched chat (board.spec, board-dnd, board-ws-updates, board-* family, code-server, worktree, etc.) are already green (verified in Phase 5) — they stay untouched; the migration focuses on chat-adjacent specs.
- **D-04:** The mock foundation from Phase 1/5 (mock-api.ts + mock-agui.ts with /run, /connect, /stop, /info) is THE source of truth for migrated specs — no new real-server paths in UI specs (AGENTS.md discipline). Extend mock-agui with script variants as needed for migrated scenarios.
- **D-05:** The full gate at the end: `bun run build` + full Playwright suite (all specs) + `bun test e2e/api --timeout 30000` + `bun test src/bun --timeout 20000` + `bun run typecheck` — all green on the new stack (success criteria 2+3).
- **D-06:** Bridge/runner contract suites (src/bun/copilotkit + execution-seam) stay green throughout (they're stack-core, already green).

### the agent's Discretion

- Exact migration ordering (which specs first) — planner picks by dependency/size.
- Whether migrated specs reuse the old test IDs (lettered M/N/O) or get new ones.
- Whether any legacy spec is retired rather than migrated (e.g., if it tests a removed feature) — must be recorded with rationale.

### Deferred Ideas (OUT OF SCOPE)

- Old chat stack deletion + feature trim + import retirement — Phase 7.
- New feature specs beyond migration (regenerate, suggestions) — v2.
</user_constraints>

## Summary

The phase goal is that **every** automated suite is green on the new stack: all 53 Playwright spec files (not 55 — count drift, see Assumptions A1), the new chat/board specs, backend smoke tests (`e2e/api`), and bridge/runner unit suites (`src/bun`). This session produced the definitive baseline by running the **full suite**: 713 tests across 53 files → **408 passed / 301 failed / 4 did not run** (16.6 min), plus `e2e/api` 82 pass, `src/bun` 2396 pass / 2 skip, typecheck clean, build clean, mock-agui self-tests 19 pass.

**The single most important finding: the red surface is 25 spec files — not the 10 listed in CONTEXT D-01.** The CONTEXT's expected-red list (chat, chat-session-drawer, queue-messages, model-persistence, reasoning-mode-select, extended-chat, delegate-rendering, conversation-body, attachment-history, autocomplete) is real but incomplete. Fifteen additional files are also red: mcp-tools (34), interview-me (23), timeline-pipeline (21), stream-reactivity (17), tool-rendering (13), conversation-pagination (10), sampling-preset-select (8), cursor (7), conversation-draft (7), task-drawer (6), code-server (5), model-picker-multi-engine (5), compact-button (3), transition-card-legacy (2), conversation-stream-state (2). Phase 5's verification only exercised the UI-04 regression set (board + board-ws-updates + chat-copilotkit) — the other chat-adjacent specs were red-by-design and never re-run. The planner MUST size for 25 files.

**The second finding: retirement is a first-class part of this phase, not an edge case.** Verified against code, the new chat surface removed: the in-chat model selector, the per-model reasoning-effort selector, the sampling-preset selector, the message queue UI, the context/compaction ring, CodeMirror chips (#/@/LSP), the MCP server popover, CodeRef chips in the input, load-older pagination, virtualization, draft persistence, and `.msg--prompt`/`transition_event` rendering. Roughly 11 whole files + ~40 in-file tests test these removed features. CONTEXT's agent's-discretion clause explicitly allows retiring specs that test removed features "with rationale" — this research provides the verified rationale per file, and recommends the planner put every retire decision behind a per-file checkpoint.

**The migration pattern is established and cheap:** every migrated spec keeps its test intent but swaps (a) message injection from `api.handle("conversations.getMessages")` + `ws.pushStreamEvent` to the `agui` fixture's script variants (quick/toolcall/reasoning/interrupt/slow/error) and `registerThread`, and (b) DOM assertions from legacy classes (`.msg--user`, `.msg__bubble.streaming`, `.cm-content`, `.rb`, `.tc`) to the new testids (`copilot-chat-view`, `chat-input`, `stop-btn`, `chat-stopped`, `tool-card-*`, `decision-card`, `copilot-slash-menu`, reasoning card `[data-message-id]`). chat-copilotkit.spec.ts (15/15 green) is the canonical template. Mock-agui needs one modest extension (a configurable multi-message history replay variant) to cover the history-ordering and scroll intents (chat O-9/10/11, CD-A-4/E-1, TD-5/6, stream-reactivity E-7).

**Primary recommendation:** Plan in three waves — (1) retire-first (delete/annotate the 11 removed-feature files + in-file retires; each behind a human checkpoint since retirement is irreversible), (2) migrate the 13 migrate-files in dependency order (smallest/clearest first: chat.spec, delegate-rendering, conversation-body → tool/stream files → session/interview files), (3) the full-suite gate (build + all Playwright + e2e/api + src/bun + typecheck) as the last task, exactly per D-05.



<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| VERF-02 | Playwright E2E suite is migrated onto the new mock fixture foundation (SSE/CopilotKit events mocked) and passes | Full-suite baseline (301 red / 25 files), per-file migration/retire classification below, mock-agui capability inventory, canonical template (chat-copilotkit.spec), helper/retire patterns |
| VERF-03 | Backend smoke tests and the 55 existing UI specs are green on the new stack before cleanup | Verified green now: e2e/api 82 pass, src/bun 2396 pass, typecheck clean, build clean; the gate sequence in D-05 is the last task |

Note: "55 existing specs" (ROADMAP) vs 53 spec files on disk — see Assumptions Log A1; the gate is interpreted as "all spec files green".
</phase_requirements>

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| UI-spec HTTP mocking (`/api/*` RPC) | Test fixture (ApiMock, page.route) | — | AGENTS.md discipline: UI specs never hit a real Bun server; ApiMock 501-loud |
| AG-UI SSE mocking (`/api/copilotkit/*`) | Test fixture (MockAgui, page.route) | — | MockAgui owns run/connect/stop/info with EventEncoder-framed, byte-identical bodies (D-04); ApiMock route.fallback defers the prefix |
| Board push mocking (`/ws`) | Test fixture (WsMock) | — | task.updated/code.ref/lsp/chatSession.updated still flow via WsMock; untouched by migration |
| Wire-format truth for the mocks | Backend API tests (e2e/api) | — | probe-agent.ts builders + sse-text-diff.test.ts validate the mock's bytes against the real runtime (PITFALLS.md Pattern 11 mitigation) |
| Bridge/runner contract | Backend unit tests (src/bun) | — | VERF-01 suites (D-06) — must stay green; no UI-spec dependency |
| Migrated-spec assertions (RailyinChat DOM) | Browser tier (Playwright locators) | — | Assertions target the CopilotKit surface testids, never server internals |
| Feature-trim evidence for retires | Codebase (src/mainview) | .planning/research/FEATURES.md | Every retire decision is backed by a grep-verified "feature exists only in dead legacy component" claim |

## Verified Baseline (this session)

All claims in this section were produced by running the actual suites on the current HEAD (1825d79c), after a fresh `bun run build` (18.4s). The full Playwright run: `npx playwright test e2e/ui` → **408 passed / 301 failed / 4 did not run** (16.6 min, 6 workers, chromium). The 4 did-not-run are delegate-rendering's serial-mode cascade (DR-1 fails → DR-2..5 skipped) — see Pitfall 4.

### Full-suite state by file (53 files)

**Fully green (28 files — stay untouched, migration must not disturb):** board.spec (34), board-setup, board-dnd, board-ws-updates (6), board-allowed-transitions, board-batch-delete, board-capacity, board-create-task, board-header-workflow-edit, board-project-badge, board-selection-persistence, board-unread, board-workspace-nav, chat-copilotkit (15), chat-sidebar, deferred-column-prompt, language-servers (22), notes (16), review-overlay (12), session-chat-notes, session-sidebar-edge, task-execution-cwd, task-toolbar (18), workflow-setup, worktree-management (43), ws-reconnect-session, code-server's CS-A/B/C (10 of 15), task-drawer's chrome tests (4 of 10), conversation-stream-state's SS-3, interview-me's Decisions-tab tests (6 of 29), stream-reactivity's B-1/D-1, sampling-preset-select's X-60/X-61.

**Red (25 files, 301 tests):**

| # | Spec file | Red | Total | Classification (this research) |
|---|-----------|-----|-------|-------------------------------|
| 1 | chat.spec.ts | 12 | 12 | MIGRATE — M/N/O suites → S/E/C patterns; task-card exec-* classes stay; N-9 queue assertion retires in-file |
| 2 | chat-session-drawer.spec.ts | 26 | 45 | MIGRATE 19 (B/C/D-3/E-1/E-4/J-1/L-1/A-4) + 19 already green stay + RETIRE 7 in-file (A-6, G-1..3, H-2 model selector; D-6 submitDecisions; K-1/K-2 file chips) |
| 3 | queue-messages.spec.ts | 25 | 25 | RETIRE whole file — queue UI removed (no queue-btn/queue-chip in any new component; verified grep) |
| 4 | model-persistence.spec.ts | 10 | 10 | RETIRE whole file — in-chat model selector removed (`.input-model-select` only in dead ConversationInput.vue:175) |
| 5 | reasoning-mode-select.spec.ts | 3 | 4 | RETIRE whole file — per-model reasoning-effort selector removed (ConversationInput.vue:290 only); CHAT-05 covered by chat-copilotkit C-2; thinkingFormat now engines.yaml config (AGENTS.md) |
| 6 | extended-chat.spec.ts | 19 | 19 | MIGRATE P-12/13/14 (stop/cancel) → stop-btn + exec-* classes; RETIRE P-15, Q-16..20 (model selector), R-20..25+23 (compaction — trimmed feature), S-1..3 (legacy decision_request_prompt ws flow — covered by C-4/C-5) |
| 7 | delegate-rendering.spec.ts | 1 (+4 DNR) | 5 | MIGRATE all 5 → subagent toolcall script + DelegateSummaryRenderer (`tool-card-tc-sub`); serial mode can be dropped (route clobbering disappears with agui fixture) |
| 8 | conversation-body.spec.ts | 5 | 5 | MIGRATE CB-1/CB-1b (reasoning) → reasoning script + `[data-message-id]`; CB-3 (tool groups) → toolcall script; RETIRE CB-2 (virtualization — PERF-01 deferred, full replay v1) and CB-4 (transition cards — trimmed feature) |
| 9 | attachment-history.spec.ts | 3 | 3 | RETIRE whole file — `[#ref|label]` chip rendering (`.inline-chip-text__chip--file`) exists only in dead MessageBubble/InlineChipText; attachments out of scope (CONT-01) |
| 10 | autocomplete.spec.ts | 34 | 34 | MIGRATE slash + editor-behavior subset (~12: AC-1/2/3/10/11/12/16/21/22/25/29/30) → copilot-slash-menu pattern (C-3); RETIRE ~22 (AC-4..9, 13..15, 17..20, 23, 24, 26..28, 31..34 — CodeMirror chips/#/@/LSP + attachments) |
| 11 | mcp-tools.spec.ts | 34 | 34 | RETIRE whole file — MCP server popover UI (V-1..33) exists only in dead ConversationInput; MCP tool calls in chat covered by default-card (T-1) pattern |
| 12 | interview-me.spec.ts | 23 | 29 | MIGRATE 23 → interrupt script + decision-card (.di__option / decision-submit / notes / recordAsDecisions toggle — DecisionInterrupt.vue); 6 green (T-F/G, T-H/H2, T-I/I2 — Decisions tab) stay |
| 13 | timeline-pipeline.spec.ts | 21 | 21 | MIGRATE streaming intents (T-28..33, 35) → quick/reasoning scripts; RETIRE status_chunk (T-34/36 — trimmed), compaction/transition events |
| 14 | stream-reactivity.spec.ts | 17 | 19 | MIGRATE A-1..3, C-1/2, E-1..7 (autoscroll), F-1, G-1/2 (writtenFiles stats → FileChangesRenderer +N/−M) → agui scripts + CopilotChat scroll container; RETIRE B-2 (data-stream-version), F-2 (status_chunk); B-1/D-1 green stay |
| 15 | tool-rendering.spec.ts | 13 | 13 | MIGRATE all → toolcall script; S-25 rawDiff → FileChangesRenderer→FileDiff dispatch (verified FileChangesRenderer.vue:15), S-26/31 subagent → DelegateSummaryRenderer, S-27 stale → replay-completed (T-3), S-29..33 cursor-family → generic scripts (model-agnostic) |
| 16 | conversation-pagination.spec.ts | 10 | 10 | RETIRE whole file — load-older sentinel pagination removed; full-history replay is v1 behavior (PERF-01) |
| 17 | sampling-preset-select.spec.ts | 8 | 10 | RETIRE whole file — preset selector removed from input (AGENTS.md: presets now per-model in engines.yaml); X-60/X-61 green trivially (negative assertions) |
| 18 | compact-button.spec.ts | 3 | 3 | RETIRE whole file — context ring + manual compact removed (compaction_summary in trimmed list) |
| 19 | transition-card-legacy.spec.ts | 2 | 2 | RETIRE whole file — `.msg--prompt`/`transition_event` conversation rendering removed (transition_event in trimmed list) |
| 20 | cursor.spec.ts | 7 | 7 | MIGRATE CU-2.1/3.1/4.1 (render intents, model-agnostic) → agui scripts; RETIRE CU-1.1/1.2 + picker tests (model picker removed) |
| 21 | conversation-draft.spec.ts | 7 | 7 | RETIRE whole file — CodeMirror draft persistence removed; CopilotChatInput has no draft/initialValue props (verified d.ts) |
| 22 | model-picker-multi-engine.spec.ts | 5 | 5 | RETIRE whole file — engine-grouped model picker removed with the legacy input; ManageModelsModal (workspace-level enable/disable) is a different surface |
| 23 | task-drawer.spec.ts | 6 | 10 | MIGRATE MSG-1 (send without reopen), TD-5/6 (latest message + ordered history) → connect replay; RETIRE TD-2 (toolbar chrome), TD-3 (attachment chip), TD-7 (transition cards); TD-1/4/8 green stay |
| 24 | code-server.spec.ts | 5 | 15 | RETIRE CS-D-1..5 — CodeRef chips in input area (`.attachment-chip .ln__*` only in dead ConversationInput); code.ref WS dispatch + overlay flow (CS-A/B/C, 10 green) stay |
| 25 | conversation-stream-state.spec.ts | 2 | 3 | MIGRATE SS-1/SS-2 (cross-thread stream isolation) → threadId-switch pattern (WR-02 state reset); SS-3 green stays |

**Totals:** ~111 whole-file retires + ~40 in-file retires ≈ 151 tests retired; ~126 tests migrated/rewritten; 25 files touched; 28 green files untouched.

### Verified backend baseline (D-05/D-06 preconditions — all green now)

| Suite | Result | Command |
|-------|--------|---------|
| Frontend build | ✓ 18.4s | `bun run build` |
| Typecheck | ✓ clean | `bun run typecheck` |
| Backend smoke (e2e/api) | ✓ 82 pass / 0 fail (110.9s) | `bun test e2e/api --timeout 30000` |
| Bridge/runner units (src/bun) | ✓ 2396 pass / 2 skip / 0 fail (58.1s) | `bun test src/bun --timeout 20000` |
| MockAgui self-tests | ✓ 19 pass / 0 fail | `bun test e2e/ui/fixtures/mock-agui.test.ts` |

## Standard Stack

No new packages for this phase — it consumes the pinned existing stack. Verified versions from the installed tree / lockfile:

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| @playwright/test | 1.59.1 | E2E runner | Already configured (playwright.config.ts); chromium project only |
| @ag-ui/core / @ag-ui/encoder / @ag-ui/client | 0.0.57 | AG-UI protocol + SSE framing | MockAgui's EventEncoder framing is the runtime's own encoder — never hand-rolled (PITFALLS.md) |
| @copilotkit/vue | 1.66.4 | Vue chat SDK (v2) | The surface under test; pinned (STATE.md Phase 1 decision) |
| bun test (vitest) | bun 1.4.0 | Fixture unit tests + backend suites | mock-agui.test.ts pattern; D-05 gate command |
| vite preview | via npx | Serves dist/ for Playwright | playwright.config.ts webServer |

**Version verification:** `npx playwright --version` → 1.59.1 ✓; `bun --version` → 1.4.0 ✓; node v20.20.1 ✓. No version bumps are part of this phase — bumping @copilotkit/vue or @ag-ui independently is explicitly forbidden (STATE.md).

## Package Legitimacy Audit

> Required whenever the phase installs external packages.

**No packages to install.** This phase adds zero dependencies (all tooling pinned and already installed). The audit gate is N/A; the only "code" added is test/fixture code under e2e/ui/ consuming the existing stack. If the planner's executor finds itself tempted to add a package (e.g., an SSE helper, a diff matcher), that is a don't-hand-roll violation — the existing `@ag-ui/encoder` + `probe-agent.ts` builders cover it.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                          ┌──────────────────────────────────────────────────────┐
                          │                  Playwright (chromium)                │
   e2e/ui/*.spec.ts  ────▶│  page.route("/api/**")          page.route("/api/    │
   (migrated specs)       │    └─ ApiMock (501-loud)          copilotkit/**")     │
                          │        └─ route.fallback ───────▶ └─ MockAgui         │
                          │  page.routeWebSocket("/ws")          ├─ POST /run     │
                          │    └─ WsMock (board pushes)          ├─ POST /connect │
                          │                                     ├─ POST /stop     │
                          │  vite preview ── serves dist/ ──▶   └─ GET /info      │
                          └──────────────────────────────────────────────────────┘
                                        │
        fixture truth (never drifts)    │ EventEncoder frames + probe-agent.ts
                                        ▼
   e2e/api (REAL Bun server)  ◀─── sse-text-diff.test.ts validates MockAgui bytes
   src/bun (unit suites)     ◀─── bridge/runner contract tests (VERF-01, D-06)
```

Data flow for a migrated streaming spec: `page.goto("/")` → ApiMock baseline answers workspace/board/tasks → `openTaskDrawer` → RailyinChat mounts → CopilotChat fires `POST /agent/default/connect` (MockAgui answers empty body for never-run threads) → `submitChatMessage` types into `chat-input` textarea + Enter → `POST /agent/default/run` (MockAgui streams the scripted SSE) → assertions on `copilot-chat-view` content → optional `/stop` + `stopRequests` capture.

### Recommended Project Structure

No new directories. Changes confined to:

```
e2e/ui/
├── fixtures/
│   ├── mock-agui.ts          # EXTEND: multi-message history variant (see Pattern 3)
│   ├── mock-agui.test.ts     # EXTEND: unit tests for the new builder (same pattern)
│   ├── index.ts              # auto-use fixtures — unchanged (agui already wired)
│   ├── helpers.ts            # ADD chat-surface helpers (submitChatMessage etc.); DO NOT touch openSidebar/openSessionDrawer/typeInSessionEditor (green specs depend on them)
│   └── mock-api.ts           # unchanged (route.fallback contract is fixed)
├── chat.spec.ts              # MIGRATE (keep file, rewrite suites)
├── chat-session-drawer.spec.ts  # MIGRATE 19 + RETIRE 7 in-file
├── ... (migrated files keep their filenames so git history and ROADMAP counts survive)
└── queue-messages.spec.ts    # RETIRED — delete file + record rationale (or move to e2e/ui/retired/ if the planner prefers auditable retires)
```

### Pattern 1: The Canonical Migrated Spec (copy chat-copilotkit.spec.ts)

**What:** every migrated spec follows the same skeleton the Phase 5 suite established. **When to use:** all 13 migrate files.

```typescript
// Source: e2e/ui/chat-copilotkit.spec.ts (15/15 green — the canonical template)
import { test, expect } from "./fixtures";
import { openTaskDrawer } from "./fixtures";
import { makeTask } from "./fixtures/mock-data";

// Helpers already established by the canonical spec — extract to fixtures/helpers.ts
function chatTextarea(page: Page) { return page.locator('[data-testid="chat-input"] textarea'); }
async function submitChatMessage(page: Page, text: string) {
    const input = chatTextarea(page);
    await input.click(); await input.pressSequentially(text); await page.keyboard.press("Enter");
}

test("S-1: submitted message streams the assistant text via /run (CHAT-01)", async ({ page, api }) => {
    const t = makeTask({ id: 101, conversationId: 101, title: "Streaming Task" });
    api.handle("tasks.list", () => [t]);
    await page.goto("/");
    await openTaskDrawer(page, t.id);
    const chat = page.locator('[data-testid="copilot-chat-view"]');
    await expect(chat).toBeVisible({ timeout: 10_000 });
    await submitChatMessage(page, "stream this please");
    await expect(chat).toContainText("stream this please", { timeout: 10_000 });
    await expect(chat).toContainText("hello", { timeout: 10_000 }); // quick-script text
});
```

Key mapping table the executor uses for each migrated assertion:

| Legacy construct (dead) | New construct (verified) |
|------------------------|--------------------------|
| `.msg--user` / `.msg--assistant` bubbles | `[data-testid="copilot-chat-view"]` content + `[data-message-id]` message rows |
| `.msg__bubble.streaming` | streaming rendered by CopilotChat from `buildQuickRunEvents` (assistant "hello" text) |
| `.rb` / `.rb__content` reasoning bubble | `[data-message-id="r1"]` reasoning card (collapsed "Thinking…"/"Thought for", expand via button) — C-2 |
| `.tc` tool cards / `.tc__tool-name` | `[data-testid="tool-card-{toolCallId}"]` (toolcall script: tc-card/tc-bash/tc-sub/tc-write) or `copilot-tool-render` (generic) — T-1/T-2 |
| `.delegate-divider` / nested children | subagent tool call → `tool-card-tc-sub` DelegateSummaryRenderer (intent + markdown result) — T-2 |
| `.task-detail__input .pi-stop-circle` / send-btn | `[data-testid="stop-btn"]` (isRunning only) + `[data-testid="chat-stopped"]` "Stopped" chip — C-1 |
| `.task-detail__input .cm-content` (CodeMirror) | `[data-testid="chat-input"] textarea` (CopilotChatInput) |
| `.cm-tooltip-autocomplete` slash menu | `[data-testid="copilot-slash-menu"]` + `[role="option"]` — C-3 |
| `.input-model-select` / `.model-select__value` | REMOVED — no equivalent (retire) |
| `queue-btn` / `queue-chips` | REMOVED — no equivalent (retire) |
| `.ctx-popover` / `context-ring-btn` / `.msg--compaction` | REMOVED (retire) |
| `.msg--prompt` / `.transition-card` | REMOVED (retire) |
| `.inline-chip-text__chip--file` / `.chat-editor__chip` | REMOVED (retire) |
| `conversations.getMessages` / `tasks.sendMessage` / `ws.pushStreamEvent` | `agui` fixture scripts + `api` baseline (RPC stubs stay for non-chat RPCs) |

### Pattern 2: Retire-with-Rationale

**What:** a spec file (or test) is deleted when its subject exists only in the dead legacy stack. **When to use:** the 11 whole-file + ~40 in-file cases in the baseline table. **Verification rule:** a retire is only justified after a grep proves the feature's DOM/component exists exclusively in a legacy component that no mounted view imports (verified this session for every entry — e.g., `queue-btn` appears only in `ConversationInput.vue`, which no live view imports; `input-model-select` only at ConversationInput.vue:175; `attachment-chip .ln__` only in ConversationInput.vue).

```bash
# The verification an executor runs before deleting a spec (example: model selector)
rg -n "input-model-select|model-select__value" src/mainview/    # → only dead ConversationInput.vue
rg -n "ConversationInput" src/mainview/ --include="*.vue" -l    # → no live importer (only legacy files)
```

**Record:** each retired file gets its rationale in the plan (and Phase 6 SUMMARY) — one line: what it tested, where the feature went (removed / config-moved / covered-by-new-spec). Per CONTEXT discretion, retirement must be "recorded with rationale" — the planner should gate each retire behind a `checkpoint:human-verify` since deletion is irreversible (git history survives, but the intent decision deserves a human nod).

### Pattern 3: MockAgui Script Selection + the One Required Extension

**What:** the fixture already serves six run scripts and connect replay. The migrated specs select per scenario; the one gap is a configurable multi-message history replay.

| Scenario | Fixture setup (verified in mock-agui.ts) |
|----------|------------------------------------------|
| Basic streaming / error / stop | `agui.script = "quick" / "error" / "slow"` (slow holds the fulfill 3s, no terminal) |
| Tool cards (domain renderers) | `agui.script = "toolcall"` → tc-card (generic), tc-bash (shell), tc-sub (delegate), tc-write (file) |
| Reasoning card | `agui.script = "reasoning"` → REASONING_MESSAGE_* then text then terminal |
| Decision interrupt | `agui.script = "interrupt"` → RUN_FINISHED with interrupt outcome (2 exclusive questions); flip to `"quick"` before submit so the resume run completes; `agui.lastRunInput.resume` holds answers |
| History replay (reopen) | `agui.registerThread(String(conversationId))` then open → connect replays historic events + MESSAGES_SNAPSHOT + single RUN_FINISHED; never-run thread → empty body (RUNR-06) |
| /stop capture | `agui.stopRequests` array (threadId from URL path) |

**Required extension — multi-message history variant.** Intents chat O-9/10/11 (4 messages in order), CD-A-4 (prior messages render), CD-E-1 (chronological order), TD-5/6 (latest message + ordered list), stream-reactivity C-1/C-2/E-7 need a connect replay whose MESSAGES_SNAPSHOT carries a *configurable alternating user/assistant history* instead of the fixed single "hello" message. Today `buildConnectReplaySseBody` hardcodes the snapshot (mock-agui.ts:334-347). The clean extension: add a `historyMessages?: Array<{id, role, content}>` knob on MockAgui (defaulting to today's behavior) + a `registerHistory(threadId, messages)` method, threaded through `buildConnectReplaySseBody` — every frame still goes through EventEncoder + `patchRunStartedInput` (never hand-rolled frames), and mock-agui.test.ts gets the new-builder cases (Pitfall 6). The historic event sequence stays the quick sequence; only the snapshot grows. Wire-format validation against the real server is unaffected (the snapshot is client-consumed, not runtime-framed — it already differs from the quick sequence).

### Pattern 4: The Full-Suite Verification Sequence (D-05)

Ordered gate, last task of the phase (all verified commands):

```bash
bun run build                              # ~19s
npx playwright test e2e/ui                 # full suite, all 53 files (~17 min at 6 workers)
bun test e2e/api --timeout 30000           # 82 tests (~111s)
bun test src/bun --timeout 20000           # 2396 tests (~58s)
bun run typecheck                          # tsc --noEmit
bun test e2e/ui/fixtures/mock-agui.test.ts # fixture self-tests, after any mock-agui change
```

Per-wave (not just at the end): after each migrated file, run that file alone (`npx playwright test e2e/ui/<file>.spec.ts`) — serial-cascade and fixture regressions surface fastest file-by-file (Pitfall 4). Before the final gate, re-run `chat-copilotkit` + `board` + `board-ws-updates` as the regression tripwire (they must never be touched by migration).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| SSE frame encoding | String templates with `data: {...}\n\n` | `EventEncoder` from @ag-ui/encoder (mock-agui.ts:35) | Framing/content-type drift silently drops events in the client (PITFALLS 11.3); the encoder is the runtime's own |
| Run event sequences | New hand-written AG-UI event arrays | `buildQuickRunEvents` / `buildToolCallRunEvents` / `buildInterruptRunEvents` from e2e/api/copilotkit/probe-agent.ts + mock-agui.ts | The canonical builders mirror the real ScriptedAgent/bridge byte-for-byte; sse-text-diff.test.ts proves them |
| Multi-turn snapshot merge semantics | Custom snapshot merge logic | Extend `buildConnectReplaySseBody` with a messages knob (Pattern 3) | The replay frame ordering (historic → MESSAGES_SNAPSHOT → single terminal) is wire-validated; the client's verifyEvents rejects events after RUN_FINISHED |
| A queue/send-button state test "shim" | Re-adding queue UI or send-btn testids to RailyinChat just to satisfy old specs | Retire the spec (Pattern 2) | Re-adding removed UI for tests is scope creep into Phase 7's trim; the UI-SPEC explicitly has no queue affordance (05-UI-SPEC:140) |
| Mocking the real server path | New real-server e2e specs for migrated intents | MockAgui scripts + keep e2e/api as the single real-server layer | AGENTS.md discipline (D-04); e2e/api already validates the wire |
| Parallel-safe shared state | Module-level registries/handlers in fixtures | Per-instance state (MockAgui.knownThreadIds is per-fixture-instance — WR-05) | Cross-test leakage broke replay contracts before (mock-agui.ts:281-285) |

**Key insight:** this phase is a *consumption* phase — the mock foundation, canonical spec, and wire builders already exist and are proven (chat-copilotkit 15/15 + mock-agui self-tests + e2e/api text-diff). The failure mode to avoid is inventing new fixture machinery instead of extending the existing builders in the smallest possible way.

## Runtime State Inventory

> Migration phase (spec migration) — included per protocol. The canonical question — *"after every file in the repo is updated, what runtime systems still have the old string cached, stored, or registered?"* — applies to deleted spec files and their mocked protocol surface.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — the phase touches only `e2e/ui/*.spec.ts`, `e2e/ui/fixtures/*`, and Playwright artifacts. No databases, JSONL threads, or datastores hold spec names or mocked-RPC strings. | None |
| Live service config | None — UI specs never touch a live Bun server (AGENTS.md); no external service config references spec names. The mock surface (`/api/copilotkit/*`, `route.fallback`) is code, not config. | None |
| OS-registered state | None — no Task Scheduler/pm2/launchd entries reference specs or fixtures. | None |
| Secrets/env vars | None — no env vars reference spec names; Playwright env (`CI`) only changes retries/workers (playwright.config.ts:28-29). | None |
| Build artifacts | `test-results/` + `playwright-report/` (gitignored) accumulate per-run artifacts from the red suites; `dist/` is rebuilt by the gate. | None — Playwright cleans on next run; `dist/` rebuilt by D-05. Optionally `rm -rf test-results playwright-report` before the final green gate so the gate artifacts reflect the green run. |

**Nothing found in category:** Stored data, Live service config, OS-registered state, Secrets/env vars — explicitly verified above (no grep-able runtime references; the phase has no runtime surface).

## Common Pitfalls

### Pitfall 1: Planning for 10 specs when 25 are red
**What goes wrong:** The CONTEXT's expected-red list (10 files) is incomplete — 15 more files are red (baseline table). A plan sized for 10 files under-delivers VERF-02 and fails the gate. **Why it happens:** Phase 5's verification only ran the UI-04 regression set; the other chat-adjacent specs were red-by-design and never re-run. **How to avoid:** Size for the 25-file matrix above; treat the CONTEXT list as "the files the discuss-phase knew about", not the scope. **Warning signs:** plan tasks that say "migrate the 10 expected-red specs" without covering mcp-tools/interview-me/timeline-pipeline/etc.

### Pitfall 2: Over-retirement — retiring a spec that tests a live feature
**What goes wrong:** A removed-looking selector hides a live feature elsewhere (e.g., `model-select` gone from the chat but still present in a workspace modal), and deleting the spec silently drops real coverage. **Why it happens:** Retirement based on selector absence in one component, without checking the whole view tree. **How to avoid:** Every retire in the table above was verified by grep over the *entire* `src/mainview/` (e.g., `input-model-select` exists only in dead ConversationInput.vue:175; no live view imports ConversationInput). Executors must re-run the same greps (Pattern 2) before deleting; the planner gates each retire behind `checkpoint:human-verify`. **Warning signs:** A retired test's RPC method still appears in `src/shared/rpc-types.ts` AND has a live consumer.

### Pitfall 3: Disturbing green specs via shared fixtures/helpers
**What goes wrong:** Migrated specs need `submitChatMessage`; if the executor rewrites the existing `sendMessage` helper (CodeMirror-based, helpers.ts:18-23), or touches `openSidebar`/`openSessionDrawer`/`typeInSessionEditor`, the 28 green files that use them (chat-sidebar: 33 usages, session-sidebar-edge: 4, plus board.spec's sidebar flow) break. **Why it happens:** "One helper for everything" instinct. **How to avoid:** ADD new chat-surface helpers (Pattern 1's `chatTextarea`/`submitChatMessage`) to helpers.ts; leave every legacy helper byte-identical. Same rule for mock-api.ts baseline stubs — `route.fallback` handoff is a fixed contract (mock-api.ts:95-98). **Warning signs:** A green file's spec fails after a fixture edit that wasn't aimed at it.

### Pitfall 4: Serial-mode cascades hide failures ("did not run")
**What goes wrong:** delegate-rendering.spec.ts is `test.describe.configure({ mode: "serial" })` — DR-1 fails and DR-2..5 never run, so a "fixed" DR-1 can leave 4 hidden failures until the file is run alone. The full-suite log showed exactly this: 4 did not run. **Why it happens:** Serial mode short-circuits after the first failure; retries:0 locally. **How to avoid:** After migrating delegate-rendering, run the file alone; once migrated onto the agui fixture, drop serial mode (route clobbering was the original reason — page.route is per-test with the auto-use fixtures, so parallel is safe; verify by running the file with default workers). **Warning signs:** Summary lines containing "did not run" — always resolve which tests and why.

### Pitfall 5: fullyParallel flakiness from the slow script
**What goes wrong:** `agui.script = "slow"` delays the /run fulfill by 3 seconds (mock-agui.ts:437) per running test. With `fullyParallel: true` and ~6 workers, several stop-scenario tests (chat.spec N-6 → C-1, extended-chat P-12/13/14, CD-J-1) running concurrently all hold 3s sockets; on slow CI machines the stop-click may race the fulfill. **Why it happens:** Timing-sensitive stop tests under parallel load. **How to avoid:** Keep stop-scenarios in one file per worker slot if flaky; assert on `agui.stopRequests` (deterministic) not on timing; keep retries:0 locally but note CI uses retries:2 (playwright.config.ts:28). **Warning signs:** Intermittent C-1 failures only under full-suite runs, green when run alone.

### Pitfall 6: Extending MockAgui without extending its self-tests
**What goes wrong:** The multi-message history knob (Pattern 3) ships without mock-agui.test.ts cases; a later refactor silently breaks the replay order (historic → snapshot → single terminal) and the client's verifyEvents rejects the stream — confusing timeouts in every history spec. **Why it happens:** Fixture code feels like test code, so it's exempt from testing — but it's the *source of truth* for the migrated suite (D-04). **How to avoid:** Every builder change in mock-agui.ts gets a case in mock-agui.test.ts (19 tests today, pure-node, no Page needed — same pattern). **Warning signs:** A new knob on MockAgui with no corresponding `describe` block in mock-agui.test.ts.

### Pitfall 7: Retiring by file deletion vs. keeping auditable evidence
**What goes wrong:** Whole-file retires (11 files) deleted in git leave only the commit message as rationale; a reviewer can't tell a trim-retire from an accidental delete. **Why it happens:** Deletion is the fastest way to green. **How to avoid:** Record rationale per retired file in the plan (Pattern 2 table) + SUMMARY; either delete the file with a message containing the rationale, or move it to a `e2e/ui/retired/` directory with a README (planner's choice — deletion keeps the ROADMAP "55 specs" narrative cleaner since Phase 7 owns cleanup). **Warning signs:** A retire commit with a message like "remove failing spec" and no feature reference.

### Pitfall 8: Migration ordering disturbing the canonical spec
**What goes wrong:** chat-copilotkit.spec.ts is the migration template AND a green regression set. If a migration task edits it (e.g., "extract helpers" refactor) and introduces a typo, the whole migration pattern loses its reference AND UI-01/CHAT-* coverage goes red. **Why it happens:** It's the natural place to copy from. **How to avoid:** Treat chat-copilotkit.spec.ts as frozen during Phase 6; helper extraction (Pattern 1) is a separate task with its own green check; the canonical spec only gains NEW scenarios if a migrated intent isn't covered (defer to v2 per CONTEXT). **Warning signs:** Migration commits touching chat-copilotkit.spec.ts.

### Pitfall 9: Re-running full suite only at the end
**What goes wrong:** 301 failures with several interacting causes (route clobbering, serial cascades, timing) all surface in one 17-minute gate run; triage eats the phase. **Why it happens:** "The gate is the gate." **How to avoid:** Per-file runs after each migration (Pitfall 4), the regression tripwire (chat-copilotkit + board + board-ws-updates) after every fixture change, and the full gate as the final D-05 task only. **Warning signs:** A plan whose only Playwright task is the final gate.

## Code Examples

Verified patterns from the current tree (all green, run this session):

### Common Operation 1: Streaming + history-on-reopen (chat.spec M-1/O-9 → new form)
```typescript
// Source: e2e/ui/chat-copilotkit.spec.ts S-1/S-2 (15/15 green)
// S-1: stream via /run — NEVER-run thread (no registerThread) so the ONLY
// source of "hello" is the /run stream.
const t = makeTask({ id: 101, conversationId: 101, title: "Streaming Task" });
api.handle("tasks.list", () => [t]);
await page.goto("/");
await openTaskDrawer(page, t.id);
const chat = page.locator('[data-testid="copilot-chat-view"]');
await expect(chat).toBeVisible({ timeout: 10_000 });
await submitChatMessage(page, "stream this please");
await expect(chat).toContainText("stream this please", { timeout: 10_000 });
await expect(chat).toContainText("hello", { timeout: 10_000 });

// S-2: history-on-reopen — register the thread so connect replays history;
// the second open fires a fresh POST /agent/default/connect (threadId in the
// request BODY — parseConnectRequest mirrors the real runtime).
agui.registerThread(String(t.conversationId));
const connectRequests = collectConnectRequests(page); // page.on("request") filter
// ... open, close via Escape, reopen ...
expect(connectRequests.length).toBeGreaterThanOrEqual(2);
expect(connectRequests).toContain(String(t.conversationId));
```
For the history-ordering intents (O-10 four messages in order, CD-E-1, TD-5/6), the connect replay's MESSAGES_SNAPSHOT must carry the alternating history — the Pattern 3 extension, e.g.:
```typescript
// Extension sketch (mirrors existing builders; frames still via EventEncoder):
agui.registerHistory(String(t.conversationId), [
    { id: "u1", role: "user", content: "Round 1" },
    { id: "a1", role: "assistant", content: "Reply 1" },
    { id: "u2", role: "user", content: "Round 2" },
    { id: "a2", role: "assistant", content: "Reply 2" },
]);
// then assert nth-message order inside copilot-chat-view
```

### Common Operation 2: Stop mid-run + capture /stop (chat.spec N-6/P-12 → new form)
```typescript
// Source: e2e/ui/chat-copilotkit.spec.ts C-1 (green)
agui.script = "slow"; // fixture holds the /run fulfill 3s; terminal-less body
await submitChatMessage(page, "start something long");
const stopBtn = page.locator('[data-testid="stop-btn"]');
await expect(stopBtn).toBeVisible({ timeout: 5_000 });
await stopBtn.click();
const stopped = page.locator('[data-testid="chat-stopped"]'); // client-state label
await expect(stopped).toBeVisible({ timeout: 10_000 });
expect(agui.stopRequests).toContain(String(t.conversationId)); // /stop round-trip
```

### Common Operation 3: Tool-card family assertions (tool-rendering/delegate → new form)
```typescript
// Source: e2e/ui/chat-copilotkit.spec.ts T-2 (green) — toolcall script emits
// tc-card (generic create_card), tc-bash (shell), tc-sub (subagent), tc-write (file).
agui.script = "toolcall";
await submitChatMessage(page, "run it");
const bashCard = page.locator('[data-testid="tool-card-tc-bash"]');
await expect(bashCard).toContainText("ls -la");
await bashCard.locator("button").first().click();
await expect(bashCard).toContainText("total 8");
// Replay-completed state (stale-"running" guard, RUNR-07): T-3 asserts
// .pi-check-circle present and no spinner for a registered-thread reopen.
```

### Common Operation 4: Decision interrupt intents (interview-me T-A..E → new form)
```typescript
// Source: e2e/ui/chat-copilotkit.spec.ts C-4 (green)
agui.script = "interrupt";
await submitChatMessage(page, "decide this");
const decisionCard = page.locator('[data-testid="decision-card"]');
await expect(decisionCard).toContainText("Should I apply the changes to src/auth.ts?");
await decisionCard.locator(".di__option", { hasText: "Yes, apply them" }).click();
await decisionCard.locator(".di__option", { hasText: "Fail loudly" }).click();
agui.script = "quick"; // resume run completes normally
await page.locator('[data-testid="decision-submit"]').click();
// resume payload contract (INVALID_PAYLOAD — event-bridge.ts:380-422):
await expect.poll(() => (agui.lastRunInput as { resume?: unknown[] } | null)?.resume?.length ?? 0)
    .toBeGreaterThan(0);
expect((agui.lastRunInput as any).resume[0].interruptId).toBe("decision-interrupt-1");
expect((agui.lastRunInput as any).resume[0].payload.answers.length).toBeGreaterThan(0);
```
interview-me's notes/recordAsDecisions intents map to DecisionInterrupt's notes textarea + toggle (DecisionInterrupt.vue has the `.di__option`/Other/freetext/notes surface — verified DecisionInterrupt.vue:37-122); the submitDecisions RPC assertions become resume-payload assertions.

## State of the Art

| Old Approach (pre-Phase 5) | Current Approach | When Changed | Impact |
|----------------------------|------------------|--------------|--------|
| WsMock.pushStreamEvent + `.msg__bubble.streaming` | MockAgui SSE scripts + CopilotChat rendering | Phase 1 (fixtures) / Phase 5 (UI) | All chat-content specs rewritten; board /ws specs untouched |
| `conversations.getMessages` hand-stubbed history | `/agent/:id/connect` replay with MESSAGES_SNAPSHOT | Phase 2/5 | History specs migrate to registerThread + connect capture |
| CodeMirror chat editor (`.cm-content`, chips, autocomplete) | CopilotChatInput (plain textarea, slash via toolsMenu) | Phase 5 | ~30 autocomplete/draft/chip tests retire; slash tests migrate to `copilot-slash-menu` |
| In-input model/reasoning/sampling selectors | engines.yaml per-model config; no chat selector | Phase 5 | model-persistence (10), reasoning-mode-select (4), sampling-preset (8), extended-chat Q suite retire |
| Queue chips + drain in input | No queue affordance (UI-SPEC:140 "no queue affordance") | Phase 5 | queue-messages.spec (25) retires |
| Context ring + manual compact | Removed (trim) | Phase 5/7 trim | compact-button (3) + extended-chat R suite retire |
| `.tc` nested tool cards, delegate divider | tool-call slots: tool-card-{id}, DelegateSummaryRenderer | Phase 5 | tool-rendering (13), delegate-rendering (5) migrate |
| Load-older pagination + virtualization | Full-history replay (PERF-01 deferred) | Phase 2 | conversation-pagination (10), conversation-body CB-2 retire |

**Deprecated/outdated:**
- `.msg--user` / `.msg--assistant` / `.msg__bubble.streaming` / `.conv-body` / `.cm-content` / `.cm-tooltip-autocomplete` / `.rb` / `.tc` / `.delegate-divider` / `.transition-card` / `.msg--prompt` / `.msg--compaction` / `.ctx-popover` / `queue-btn` / `input-model-select` / `input-model-settings-select` / `.model-select__value` / `context-ring-btn` / `.inline-chip-text__chip--file` / `.chat-editor__chip` — all exist only in dead legacy components (ConversationBody/Input, ChatEditor, MessageBubble, ToolCallBlock, SubagentBlock, ReasoningBubble, DecisionRequest); Phase 7 deletes them. Migrated/retired specs must not reference them.

## Assumptions Log

> All claims tagged [ASSUMED] this session. Every code-derived claim in this research was VERIFIED by running the suites or reading the source this session (see Sources).

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | ROADMAP's "55 existing specs" = the 53 spec files on disk (count drift; possibly 2 files consolidated since roadmap creation). The gate is interpreted as "all 53 files green". | Phase Requirements | If a hidden 54th/55th file exists outside e2e/ui/, the gate misses it — mitigated by running `npx playwright test e2e/ui` (testDir-bound) + `testMatch **/*.spec.ts` |
| A2 | The 11 whole-file + ~40 in-file retires are acceptable within D-01's discretion ("retired rather than migrated... if it tests a removed feature — must be recorded with rationale"). Retirement is irreversible; CONTEXT author should confirm the list before execution. | Baseline table | If the user actually wants a feature reimplemented (e.g., queue) instead of retired, the plan must grow a feature task — discuss-phase confirmation closes this |
| A3 | CopilotChatInput (1.66.4) has no draft persistence — verified from installed `CopilotChatInput.vue.d.ts` (no initialValue/draft/localStorage props). [VERIFIED: node_modules/@copilotkit/vue/dist/v2/components/chat/CopilotChatInput.vue.d.ts:20-21,74,255] | Baseline table (conversation-draft) | If a draft prop exists under a different name, conversation-draft could partially migrate — the d.ts inspection makes this very unlikely |
| A4 | The CodeRef chip UI and MCP popover UI are removed from the drawer (they exist only in dead ConversationInput.vue); the RPC/WS handlers they called (code.ref dispatch, mcp.*) remain alive for other surfaces. [VERIFIED: src/mainview/components/ConversationInput.vue:7-38,175; TaskChatView.vue toolbar has neither] | Baseline table (code-server CS-D, mcp-tools) | If Phase 7 re-adds these UIs, the retired specs would need re-creation — acceptable, Phase 7 owns trim decisions |
| A5 | Migration ordering is free of cross-spec interference (the `agui`/`api`/`ws` fixtures are per-test instances; knownThreadIds is per-instance — WR-05). No ordering constraint beyond "canonical spec first" narrative. [VERIFIED: fixtures/index.ts:41-142, mock-agui.ts:363-406] | Architecture Patterns | If a future fixture refactor introduces module-level state, parallel migrations could interleave — the mock-agui.test.ts WR-05 cases guard this |
| A6 | Interview decision-card intents (interview-me T-A..Q) map fully to DecisionInterrupt's DOM (`.di__option`, Other textarea, notes, recordAsDecisions toggle). | Baseline table (interview-me) | If DecisionInterrupt lacks a surface (e.g., checkbox-type questions), a small renderer gap appears — DecisionInterrupt.vue:37-122 verified: exclusive/Other option rows + notes + submit; checkbox question type support needs executor confirmation during migration |
| A7 | The 4 "did not run" are delegate-rendering's serial cascade (DR-2..5), consistent across both full runs. | Verified Baseline | If a worker crash is the real cause, migrated files may still crash under full-suite load — the per-file run after migration (Pitfall 4) catches it |

## Open Questions

1. **Retire-list confirmation (blocks planning):** The 11 whole-file retires (queue-messages, model-persistence, reasoning-mode-select, attachment-history, mcp-tools, conversation-pagination, sampling-preset-select, compact-button, transition-card-legacy, conversation-draft, model-picker-multi-engine) + in-file retires (~40 tests). What we know: every one tests a feature verified removed from the live UI. What's unclear: whether the user wants any of these features back (queue was a deliberate UX; model selector removal is user-visible). Recommendation: planner gates each retire behind `checkpoint:human-verify` with the one-line rationale (Pattern 2) — cheap to approve, irreversible to undo.

2. **Retire mechanics — delete vs `e2e/ui/retired/`:** What we know: CONTEXT defers "feature trim" to Phase 7 but spec retirement is Phase 6 scope. What's unclear: keeping retired files on disk (auditable, revertable) vs deleting (clean testDir, ROADMAP counts stay). Recommendation: delete with rationale in the commit message + SUMMARY table; git history is the audit trail. Planner's call.

3. **Test-ID scheme for migrated specs:** What we know: CONTEXT discretion allows reusing M/N/O letters or new ones; chat-copilotkit uses S/E/T/C/L suites. What's unclear: whether legacy IDs (M-1 etc.) should survive for cross-referencing old documentation. Recommendation: new per-file suite letters (matching the new stack, e.g., chat.spec → suites M→reuse intent but retitle, or follow the canonical file's lettering); old IDs referenced in FEATURES.md/PLAN docs are already superseded by chat-copilotkit's letters.

4. **Multi-message history knob scope (Pattern 3):** What we know: ~8 migrated tests need a configurable connect-replay snapshot; the extension is small and self-tested. What's unclear: whether to also extend the "toolcall" replay snapshot with user messages (T-3 currently only replays assistant+tool). Recommendation: minimal knob now (`historyMessages` default = current behavior); extend only if a migrated test actually needs it.

5. **chat.spec N-9's queue assertions:** the only queue-related live intent (editor enabled while running). The editor-enabled half migrates (chat-textarea enabled while isRunning); the queue-button half retires. Recommend migrating the first half into the rewritten N-9 and dropping queue assertions — planner micro-decision.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| bun | build, backend suites, fixture tests | ✓ | 1.4.0 | — |
| node | Playwright, vite preview | ✓ | v20.20.1 | — |
| Playwright + chromium | full UI suite | ✓ | 1.59.1 (chromium-1228/1234 installed) | — |
| vite preview | serves dist/ for Playwright | ✓ | via npx (webServer config) | — |
| @ag-ui/encoder + probe-agent builders | MockAgui framing | ✓ | 0.0.57 (installed) | — |
| External services (LLM engines, MCP servers) | NONE — all mocked | — | — | — |

**Missing dependencies with no fallback:** none — the phase is fully self-contained on the installed toolchain (verified by the successful full-suite + backend runs this session).

**Missing dependencies with fallback:** none.

## Validation Architecture

> workflow.nyquist_validation: true → included. This phase IS a validation phase; its "implementation" is test code, and its validation is the D-05 gate itself.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | @playwright/test 1.59.1 (UI) + bun test/vitest (fixture units, backend) |
| Config file | playwright.config.ts (testDir e2e/ui, testMatch **/*.spec.ts, fullyParallel, webServer vite preview) |
| Quick run command | `npx playwright test e2e/ui/<file>.spec.ts` (per migrated file) |
| Full suite command | `bun run build && npx playwright test e2e/ui` (~17 min) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| VERF-02 | Migrated specs pass against mock foundation | e2e | `npx playwright test e2e/ui/<migrated>.spec.ts` | ❌ Wave 0 — the migrated/retired spec files ARE the phase's test work |
| VERF-02 | MockAgui extension stays wire-valid | unit | `bun test e2e/ui/fixtures/mock-agui.test.ts` | ✅ exists (19 tests) — EXTEND for Pattern 3 |
| VERF-02 | Regression tripwire (canonical + board) | e2e | `npx playwright test e2e/ui/chat-copilotkit.spec.ts e2e/ui/board.spec.ts e2e/ui/board-ws-updates.spec.ts` | ✅ exists — must stay green |
| VERF-03 | Backend smoke green | integration | `bun test e2e/api --timeout 30000` | ✅ exists (82 tests) |
| VERF-03 | Bridge/runner units green | unit | `bun test src/bun --timeout 20000` | ✅ exists (2396 tests) |
| VERF-03 | Typecheck clean | static | `bun run typecheck` | ✅ exists |

### Sampling Rate
- **Per task commit:** the migrated file's own Playwright run (`npx playwright test e2e/ui/<file>.spec.ts` — must be green before commit)
- **Per wave merge:** regression tripwire (chat-copilotkit + board + board-ws-updates) + `bun test e2e/ui/fixtures/mock-agui.test.ts` + `bun run typecheck`
- **Phase gate:** full D-05 sequence (build + all Playwright + e2e/api + src/bun + typecheck) — success criteria 2+3

### Wave 0 Gaps
- [ ] `e2e/ui/fixtures/mock-agui.test.ts` — add cases for the multi-message history builder (Pattern 3) BEFORE the fixture extension lands
- [ ] `e2e/ui/fixtures/helpers.ts` — add `chatTextarea`/`submitChatMessage` (extracted from chat-copilotkit.spec.ts:32-59) for migrated specs
- [ ] Framework install: none needed — everything verified installed and running this session

## Security Domain

> security_enforcement: true (ASVS level 1, block on high).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface — single-user local-first app; UI specs mock all endpoints |
| V3 Session Management | no | No sessions in the mock surface |
| V4 Access Control | no | No per-user permissions in scope |
| V5 Input Validation | yes | The fixture layer is the enforcement point: ApiMock 501s unhandled RPCs (mock-api.ts:100-104), MockAgui mirrors the runtime's 400 on malformed RunAgentInput (mock-agui.ts:421-424,468-469) — migrated specs inherit these guards |
| V6 Cryptography | no | No crypto paths in this phase (JSONL + SSE only) |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Mock boundary leak — a UI spec accidentally reaching the real network | Spoofing | page.route("/api/**") intercepts all API calls; route.fallback is bounded to /api/copilotkit/* (the SSE mock owns it); any other unhandled path 501s loudly |
| Malformed SSE payloads silently dropped by the client | Tampering | EventEncoder framing from @ag-ui/encoder — never hand-rolled frames (mock-agui.ts:35, PITFALLS 11.3) |
| Mock drift from the real wire format | Tampering | sse-text-diff.test.ts (e2e/api) validates MockAgui bytes against the real runtime; probe-agent.ts is the single canonical event builder |
| Retired-spec deletion hiding a live-endpoint regression | — (process) | Retire rationale table + grep verification (Pattern 2) + e2e/api suite keeps real-server coverage of /api/copilotkit/* |

The phase introduces no new attack surface: it adds test code and fixture code only, all inside page.route interception.

## Sources

### Primary (HIGH confidence — verified by execution/read this session)
- Full Playwright suite run (53 files, 713 tests): `/tmp/pw-full-suite.log` — 408 passed / 301 failed / 4 did not run
- Expected-red 10-file run: `/tmp/pw-red-specs.log` — 138 failed / 20 passed / 4 did not run (consistent subset)
- `bun test e2e/api --timeout 30000` → 82 pass / 0 fail; `bun test src/bun --timeout 20000` → 2396 pass / 2 skip; `bun run typecheck` clean; `bun run build` 18.4s; `bun test e2e/ui/fixtures/mock-agui.test.ts` → 19 pass
- [VERIFIED] e2e/ui/fixtures/mock-agui.ts — routes/scripts/registry (read full file, lines 1-538)
- [VERIFIED] e2e/ui/fixtures/mock-api.ts:83-131 — route.fallback contract; index.ts:41-142 — per-test fixtures
- [VERIFIED] e2e/ui/chat-copilotkit.spec.ts — canonical spec (read full file, 478 lines)
- [VERIFIED] src/mainview/components/chat/RailyinChat.vue — new DOM/testids (read full file, 595 lines); DecisionInterrupt.vue:37-122; ChatThreadSidebar.vue testids; TaskChatView.vue (no model/MCP/queue chrome); SessionChatView.vue (RailyinChat swap)
- [VERIFIED] src/mainview/components/ConversationInput.vue:7-38,117-147,175,290 — queue/model/reasoning/chip UI exists ONLY here (dead)
- [VERIFIED] node_modules/@copilotkit/vue/dist/v2/components/chat/CopilotChatInput.vue.d.ts:20-21,74,255 — no draft props
- [VERIFIED] .planning/phases/05-chat-ui-replacement-vue/05-05-SUMMARY.md — Phase 5 swap + pre-existing-red attribution
- [VERIFIED] .planning/research/FEATURES.md (anti-features/trim list), PITFALLS.md:277-304 (Pattern 11)

### Secondary (MEDIUM confidence)
- .planning/ROADMAP.md §Phase 6 — success criteria wording ("55 specs" — see A1)
- .planning/REQUIREMENTS.md — VERF-02/VERF-03 wording

### Tertiary (LOW confidence)
- None — no unverified external claims used in this research

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — zero new dependencies; all pinned versions verified from installed tree/lockfile
- Architecture: HIGH — migration patterns extracted from the green canonical spec and verified fixture code, not from docs
- Pitfalls: HIGH — every pitfall observed in the two full-suite runs this session or documented in PITFALLS.md with code-verified mitigations
- Retire classification: HIGH for the 11 whole-file retires (grep-verified removed features); MEDIUM for per-test splits inside mixed files (autocomplete/timeline-pipeline/stream-reactivity) — the planner should treat the in-file splits as guidance and let each executor's grep re-confirm

**Research date:** 2026-08-09
**Valid until:** 2026-09-08 (30 days — stack is pinned; validity driven by user decisions on the retire list rather than upstream drift)




