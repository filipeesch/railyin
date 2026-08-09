# Phase 5: Chat UI Replacement (Vue) - Research

**Researched:** 2026-08-09
**Domain:** CopilotKit Vue v2 chat surface (CopilotChat + slots, CopilotChatInput, useInterrupt, useDefaultRenderTool) wrapped in thin local components; Vue 3 + Pinia + PrimeVue 4 Aura
**Confidence:** HIGH (CopilotKit API surface verified directly from the installed package `node_modules/@copilotkit/vue@1.66.4` type definitions + compiled bundle; app-side integration points verified by reading source files this session)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Adopt `CopilotChat` + `CopilotChatInput` (CopilotKit Vue v2, pinned 1.66.4) inside thin local wrapper components (early-access SDK isolation — PROJECT.md constraint). Slots used: `#interrupt` (decision cards), `#tool-call-*`/`#tool-call` (domain renderers), `#input` (slash-command affordances), message slots as needed.
- **D-02:** The board layout regions (ChatSidebar / TaskChatView / SessionChatView equivalents) are preserved — the swap happens inside the existing chat surfaces; board /ws reactivity is untouched (UI-04).
- **D-03:** Thread wiring: card chat = thread with conversation.id; session chat = thread without taskId (Phase 2 mapping). Reopening any card/session shows full history (CHAT-07) — connect replays from JSONL (Phase 2/4).
- **D-04:** Default expandable card via `useDefaultRenderTool` (name, status, args, result); domain renderers ported from legacy (shell output, file changes, delegate task summaries) as `#tool-call-*` slots — never raw JSON cards for the domain tools.
- **D-05:** Replayed tool calls show completed state (Phase 2 TOOL_CALL_RESULT synthesis) — no stale "running" cards.
- **D-06:** The `#interrupt` slot renders the ported decision card (DecisionRequest → DecisionInterrupt), wired to `useInterrupt` resolve/cancel; contract: RUN_FINISHED interrupt outcome + resume[] (Phase 3 D-01..D-09). "Submit Decision" CTA per UI-SPEC.
- **D-07:** `CopilotChatInput` toolsMenu provides slash-command affordance wired to the existing command registry; `/prompt-name` refs at parity (ref must be the entire leading value — AGENTS.md convention).
- **D-08:** Stop control: `isRunning` prop + runner stop (Phase 2 abortRun→cancel); partial responses labeled "Stopped" (UI-SPEC covered row; best-effort per-engine).
- **D-09:** Reasoning display zero-config (`CopilotChatReasoningMessage`-equivalent) — pi thinking flows through (Phase 2 bridge REASONING_*).
- **D-10:** Old chat stack code stays alive (not deleted, not imported) until Phase 6 E2E passes; this phase only stops the old UI from rendering in the chat surfaces.

### the agent's Discretion

- Exact wrapper component names/structure (thin local components around CopilotChat/CopilotChatInput).
- CSS override depth for markdown/code parity (UI-SPEC unresolved row) — planner/researcher picks the `:deep` strategy.
- Queue-dropped behavior and resume-failure UX (UI-SPEC unresolved rows) — acceptable v1 behaviors per UI-SPEC.

### Deferred Ideas (OUT OF SCOPE)

- Regenerate/retry — v2 (CHAT-10); JSONL replay fallback if Vue API unconfirmed.
- Cancel hardening per-engine — v2 (CHAT-11).
- Thread list UI (rename/archive/delete) — v2 (CHAT-13).
- Attachments — v3 (CONT-01).
- Suggestions (useConfigureSuggestions) — v2 (CHAT-12).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CHAT-01 | Token-by-token streaming (AG-UI text events) | CopilotChat connects to `/api/copilotkit` via `runtime-url`; server streams `TEXT_MESSAGE_CHUNK`; client `transformChunks` expands chunks; verified client connect/run flow + MockAgui SSE fixture |
| CHAT-02 | Markdown + code blocks at parity with old editor | CopilotChat renders via `StreamMarkdown` (streamdown-vue, Shiki code blocks); legacy parity CSS rules located (ConversationBody.vue:608-627) to port into RailyinChat `:deep` overrides |
| CHAT-03 | Every tool call an expandable card (name/status/args/result) | `#tool-call-<name>` → `#tool-call` → `useDefaultRenderTool` slot precedence verified in bundle; `CopilotChatToolCallRenderSlotProps {name,args,status,result,toolCall,toolMessage}` verified |
| CHAT-04 | Stop/cancel propagates, partial labeled | `agent.abortRun()` + `isRunning` verified on AbstractAgent; wire terminal for aborted runs is a plain `RUN_FINISHED` (indistinguishable from done) → "Stopped" label is client state in RailyinChat |
| CHAT-05 | Reasoning zero-config | `CopilotChatReasoningMessage` component ships in the package; bridge emits `REASONING_MESSAGE_*`; `useKatexStyles` hook exists |
| CHAT-06 | Slash commands + `/prompt-name` refs | `CopilotChatInput` `toolsMenu` prop + `ToolsMenuItem` type verified; `useCommandsCache.getCommands(taskId)` / `engine.listCommands` (`{taskId?, workspaceKey?} → {name, description?}[]`) verified |
| CHAT-07 | Reopen → full history across restarts | `CopilotChat` `threadId` prop drives auto-`connectAgent` on mount/switch (verified in bundle); server replays JSONL via `POST /connect` (RUNR-05, e2e test 10) |
| UI-01 | Board chat replaced, layout preserved | Swap points: TaskChatView Chat tab + SessionChatView Chat tab + ChatSidebar; ConversationDrawer mounts both views; App.vue is the provider mount point |
| UI-02 | Domain tool renderers (shell/file/delegate) | Port targets verified: ToolCallBlock.vue, SubagentBlock.vue, FileDiff.vue, ReadView.vue, `useToolResultDisplay`, `formatToolSubject`; canonical tool-name families from tool-display.ts |
| UI-04 | Board /ws reactivity keeps working | rpc.ts push dispatch untouched; board events (task.updated/code.ref/lsp) remain on /ws; `useBoardSyncHandler`/`useSessionSyncHandler` stay |
| IMPR-03 | Old chat stack alive for rollback | All legacy components/stores/composables verified present and untouched; phase only stops them rendering |

</phase_requirements>

## Summary

Phase 5 swaps the three board chat surfaces — the Chat tab of `TaskChatView.vue`, the Chat tab of `SessionChatView.vue`, and `ChatSidebar.vue` (replaced by `ChatThreadSidebar.vue` per UI-SPEC) — onto CopilotKit Vue v2 (`@copilotkit/vue@1.66.4`, pinned exact, imported from the `/v2` subpath) behind thin local wrapper components under `src/mainview/components/chat/`. All client-side APIs were verified directly from the installed package this session: `CopilotChat` props/slots/emits, `CopilotChatInput` props, `CopilotChatConfigurationProvider`, `useAgent`, `useInterrupt` (including the exact `#interrupt` slot props and the standard-interrupt `event.value` shape), `useDefaultRenderTool`/`useRenderTool`, `defineToolCallRenderer`, provider props, and the tool-call slot resolution precedence. The key mechanics: mounting `CopilotChat` with `threadId = String(conversation.id)` automatically POSTs `/api/copilotkit/agent/default/connect` and replays JSONL history (CHAT-07); tool calls resolve `#tool-call-<name>` slot → `#tool-call` slot → registered default renderer; the `#interrupt` slot renders when `useInterrupt` publishes the pending interrupt, and `resolve(payload)` submits the canonical `resume[]` array.

**Primary recommendation:** Build `RailyinChat.vue` as the single thin wrapper that (1) owns the `CopilotChat` + slots + all CopilotKit CSS overrides, (2) passes `threadId` + `inputToolsMenu` (built from `useCommandsCache`) + `hasExplicitThreadId`, (3) declares per-name `#tool-call-*` slots for the canonical domain tool families (subagent, bash/run/run_in_terminal/shell, read/read_file/view, write/write_file/create/edit/multiedit/apply_patch) backed by the three ported renderers, (4) calls `useDefaultRenderTool()` for everything else, (5) wires `useInterrupt` + the `#interrupt` slot to the ported `DecisionInterrupt.vue` decision card, and (6) tracks a local `stopped` flag for the "Stopped" label (the wire cannot distinguish aborted from done). Extend `MockAgui` with `/connect` and `/stop` routes so the new chat specs can be written this phase without touching the legacy specs (VERF-02 stays in Phase 6).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Chat message rendering + streaming | Browser (CopilotChat) | API (SSE events) | CopilotChat owns client message state; the server only emits AG-UI events over `/api/copilotkit` |
| Thread history replay (CHAT-07) | API (connect SSE) | Browser (auto-connect on threadId) | `threadId` prop triggers `connectAgent` → `POST /connect`; server replays JSONL (RUNR-05) |
| Tool-call cards (CHAT-03, UI-02) | Browser (slots + renderers) | — | Slot props carry name/args/status/result; renderers are pure presentational Vue components |
| Decision interrupts (UI-03) | Browser (`#interrupt` slot + useInterrupt) | API (interrupt outcome + resume[]) | `resolve()` fires a new resume run; server enforces block-while-pending (THREAD_BUSY) |
| Slash commands (CHAT-06) | Browser (toolsMenu) | API (`engine.listCommands`) | toolsMenu items call back into the input; registry is server-derived via useCommandsCache |
| Board `/ws` reactivity (UI-04) | Browser (rpc.ts dispatch) | Backend (WS push) | Untouched this phase — `task.updated`, `code.ref`, `lsp`, `chatSession.updated` keep flowing on /ws |
| Thread list (CHAT-08) | Browser (ChatThreadSidebar) | API (`threads.list`) | Phase 4 endpoint; status/unread enrichment source is an open question (see Open Questions) |
| Stop (CHAT-04) | Browser (`agent.abortRun()`) | API (`POST /agent/:id/stop/:threadId`) | Client calls abortRun; runtime calls runner.stop → agent abort → orchestrator.cancel; "Stopped" label is client state |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `@copilotkit/vue` | **1.66.4** (pinned exact, import from `/v2` subpath) | `CopilotKitProvider`, `CopilotChat` + slots, `CopilotChatInput`, `useAgent`, `useInterrupt`, `useDefaultRenderTool`, `useRenderTool`, `useCopilotChatConfiguration`, `CopilotChatReasoningMessage` | The only official Vue 3 SDK (v2 = AG-UI-native line); already installed and pinned via Phase 1 decision (HOST-03, D-09) |
| `@copilotkit/core` | 1.66.4 (transitive) | Client core: agent subscription, interrupt state, renderer registry (`renderToolCalls` merged with hook-registered renderers) | Auto-installed with `@copilotkit/vue`; do NOT pin separately |
| `@ag-ui/client` / `@ag-ui/core` | **0.0.57** (pinned exact) | `AbstractAgent` (isRunning, abortRun, detachActiveRun), `Message`, `Interrupt`, `RunAgentInput` types | CopilotKit pins exactly 0.0.57 — never bump independently (STACK.md) |
| `streamdown-vue` | ^1.0.29 (transitive) | `StreamMarkdown` — the markdown renderer inside CopilotChat messages (component-based AST rendering, Shiki code blocks, `cpk:` classes, `data-streamdown` hooks) | Bundled dependency of `@copilotkit/vue`; verified in the compiled bundle |
| `katex` | ^0.16.27 (transitive) | KaTeX math rendering; CSS loaded via `useKatexStyles` hook | Bundled dependency; zero-config |
| PrimeVue 4 (Aura) + PrimeIcons + `@iconify/vue` | installed | Decision card, buttons, spinner, toast; ported legacy chrome | Existing app design system; UI-SPEC requires `--p-*` tokens only |
| `marked` | installed | Legacy `useMarkdown` — keep for ported renderers that still render markdown (DelegateSummaryRenderer result, DecisionInterrupt context) | Parity: ported components use the same renderer as today |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `pinia` | ^2.2.0 | Board/session stores stay; no new chat store (CopilotKit owns message state) | RailyinChat gets props from the existing stores (task.conversationId, session) |
| `@tanstack/vue-virtual` | installed | Legacy virtualized message list | NOT needed — CopilotChat owns its scroll view |
| `rxjs` | ^7.8.2 | Server-side runner contract | Backend only; no frontend usage |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `CopilotChat` wrapper with `threadId` prop | `CopilotChatConfigurationProvider` + `setActiveThreadId()` | Provider is for multi-surface config sharing; direct `threadId` prop is simpler for one RailyinChat instance per drawer; provider warns when threadId is controlled by prop anyway |
| `useRenderTool`/`defineToolCallRenderer` per engine tool name | `#tool-call-<name>` slots in RailyinChat | Both verified working; slots keep the CopilotKit surface in the template where CSS overrides live, and match D-04 wording ("as #tool-call-* slots"); renderer hooks are the fallback for names discovered later |
| Markdown parity via `message-view` slot override | Default assistant message + CSS `:deep` overrides | `message-view` slot replaces the whole list renderer (lose CopilotChat's tool-call/interrupt plumbing for free); default + CSS is the thin-wrapper path |
| `useInterrupt()` with `handler` | no handler | Handler is optional (verified — slot still populates); a handler is only needed to compute a custom `result` label |

**Installation:** none required — `@copilotkit/vue@1.66.4`, `@copilotkit/runtime@1.66.4`, `@ag-ui/core@0.0.57`, `@ag-ui/client@0.0.57` are already in `package.json` (pinned exact) and installed. `@copilotkit/vue/styles.css` is exported via the package `exports` map (verified).

**Version verification (2026-08-09):** `npm view @copilotkit/vue version` → `1.66.4` (current); installed `node_modules/@copilotkit/vue/package.json` → `1.66.4`; `node_modules/@copilotkit/core` → `1.66.4`; `@ag-ui/client`/`@ag-ui/core` → `0.0.57`. No postinstall scripts on any package.

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| @copilotkit/vue | npm | ~2 days (1.66.4 published 2026-08-07) | 5.4k/wk | github.com/CopilotKit/CopilotKit | SUS (too-new) | Flagged — but already human-verified in Phase 1 (exact pin + pin-lock test HOST-03/D-09); NO new install this phase; thin-wrapper isolation already locked by D-01 |
| @copilotkit/runtime | npm | ~2 days (1.66.4) | 317k/wk | github.com/CopilotKit/CopilotKit | SUS (too-new) | Flagged — same mitigation; backend, not touched this phase |
| @ag-ui/core / @ag-ui/client | npm | ~2 mo (0.0.57) | 1.0M-1.4M/wk | github.com/ag-ui-protocol/ag-ui | OK | Approved |
| streamdown-vue | npm | ~9 mo (^1.0.29) | 8.4k/wk | github.com/Saluana/streamdown-vue | OK | Approved (transitive dep of @copilotkit/vue) |
| katex | npm | 1.66.4-era patch published 2026-08-08 | 21.5M/wk | github.com/KaTeX/KaTeX | SUS (too-new) | Flagged — established project (KaTeX), massive downloads, no postinstall; flag is a publish-date artifact; transitive only, no direct install |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** `@copilotkit/vue@1.66.4`, `@copilotkit/runtime@1.66.4`, `katex` — all three are already installed, pinned exact, and were human-vetted in Phase 1; this phase adds no new packages, so no `checkpoint:human-verify` install gates are required (the existing pin-lock test in `e2e/api/copilotkit/pins.test.ts` covers the pins).

## Architecture Patterns

### System Architecture Diagram

```text
┌─────────────────────────────── Vue 3 SPA (src/mainview) ───────────────────────────────┐
│  App.vue ── CopilotKitProvider (runtimeUrl="/api/copilotkit", renderToolCalls=[])       │
│   │                                                                                     │
│   ├─ BoardView.vue ── ConversationDrawer ── TaskChatView / SessionChatView (Chat tab)   │
│   │        │                          └─ ChatSidebar  →  ChatThreadSidebar (new)         │
│   │        └─ RailyinChat.vue (NEW, thin wrapper)                                       │
│   │             CopilotChat :thread-id="String(conversationId)" :input-tools-menu="…"   │
│   │               ├─ #input slot → CopilotChatInput (toolsMenu from useCommandsCache)   │
│   │               ├─ #tool-call-subagent → DelegateSummaryRenderer                      │
│   │               ├─ #tool-call-bash/run/run_in_terminal → ShellOutputRenderer          │
│   │               ├─ #tool-call-read/read_file/view → FileChangesRenderer (ReadView)    │
│   │               ├─ #tool-call-write/write_file/create/edit/multiedit/apply_patch      │
│   │               │        → FileChangesRenderer (FileDiff)                             │
│   │               ├─ useDefaultRenderTool() → default card (all other tools)            │
│   │               ├─ useInterrupt() → #interrupt slot → DecisionInterrupt.vue           │
│   │               └─ stop → agent.abortRun() + local "Stopped" label state              │
│   │                                                                                     │
│   └─ rpc.ts /ws dispatch (task.updated, code.ref, lsp, chatSession.updated) — UNTOUCHED  │
└───────────────┬───────────────────────────────────────────────────────────┬────────────┘
                │ POST/GET /api/copilotkit/* (run/connect/stop/info — SSE)  │ POST /api/* + WS /ws
                ▼                                                           ▼
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ Bun.serve — fetch() → /api/copilotkit/* → createCopilotRuntimeHandler (basePath)        │
│ CopilotRuntime → RailyinAgentRunner → RailyinAgent → orchestrator → engines → EngineEvent│
│ (all Phases 1-4, UNTOUCHED this phase; threadId must be numeric conversation.id)         │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/mainview/
├── App.vue                        # mount CopilotKitProvider here (runtime-url, no license keys)
├── components/chat/               # NEW — all CopilotKit usage (early-access isolation)
│   ├── RailyinChat.vue            # CopilotChat + slots + CSS overrides; props: threadId, title
│   ├── ChatThreadSidebar.vue      # thread list (threads.list + legacy session enrichment),
│   │                              #   resizable 160-400px (default 220, key chat-sidebar-width),
│   │                              #   New Session + Legacy Import actions
│   ├── DecisionInterrupt.vue      # #interrupt slot → ported decision card (DecisionRequest)
│   └── tool-call-renderers/
│       ├── ShellOutputRenderer.vue      # pre-formatted output, 800-char truncation
│       ├── FileChangesRenderer.vue      # FileDiff payloads / ReadView content
│       └── DelegateSummaryRenderer.vue  # intent header + Prompt details + result markdown
├── components/                   # legacy chat stack stays ALIVE (IMPR-03, not deleted/imported)
├── stores/                       # conversation.ts/chat.ts stay alive (board events still use them)
└── composables/                  # useCommandsCache.ts reused; useMarkdown.ts reused by ports
```

### Pattern 1: Thin wrapper = single CopilotKit surface (D-01)

**What:** One component (`RailyinChat.vue`) holds the entire pinned CopilotKit surface: the provider is mounted once in `App.vue`; every `CopilotChat` prop/slot/hook call lives in `RailyinChat.vue`; all CopilotKit CSS overrides live in its non-scoped style block. Upgrade path for the early-access SDK = edit one file.
**When to use:** Always — PROJECT.md constraint for the pinned early-access SDK.
**Verified API (installed 1.66.4):** `CopilotChat` props: `agentId`, `threadId`, `throttleMs`, `labels`, `attachments`, `onError`, `autoScroll`, `inputValue`, `inputMode`, `inputToolsMenu`, `welcomeScreen`, `isConnecting`, `hasExplicitThreadId`. Slots: `chat-view`, `message-view`, `interrupt`, `input`, `suggestion-view`, `welcome-screen`, `welcome-message`, plus arbitrary `[key: string]` passthrough (this is what forwards `tool-call-*` to `CopilotChatToolCallsView`). Emits: `stop`, `submit-message`, `add-file`, `start-transcribe`, `cancel-transcribe`, `finish-transcribe`, `select-suggestion`, `input-change`. Thread mechanics (verified in the compiled bundle): internal `useAgent({agentId, threadId, throttleMs})`; on mount/threadId-change it builds a run-handler and calls `connectAgent(...)` → `POST /agent/default/connect` → SSE replay; explicit `threadId` sets `hasExplicitThreadId` (suppresses the welcome screen); `isConnecting` suppresses the welcome-screen flash during connect.

### Pattern 2: Tool-call slot precedence + default card (D-04)

**What:** Per tool call, the renderer resolution order is (verified in bundle): (1) `#tool-call-<toolCallName>` slot, (2) generic `#tool-call` slot, (3) registered renderers (`useRenderTool`/`useDefaultRenderTool`/provider `renderToolCalls` — merged registry keyed `agentId:name`, wildcard `"*"` last). Slot props: `CopilotChatToolCallRenderSlotProps = { name, args, status: "inProgress"|"executing"|"complete", result, toolCall, toolMessage }`.
**When to use:** Domain tools get named slots; everything else falls through to `useDefaultRenderTool()` called once in RailyinChat setup. Do NOT provide a generic `#tool-call` slot — it would swallow every tool and force reimplementing the default card.
**Tool-name families (canonical, [VERIFIED: src/bun/engine/tool-display.ts:19-49]):** read: `read|read_file|view`; write: `write|create|write_file`; edit: `edit|multiedit`; run: `bash|run|run_in_terminal`; search: `grep|rg|grep_search`; find: `find|find_files|glob`; list: `ls`; fetch: `webfetch|web_fetch`; plus `apply_patch` (diff family) and `subagent` (bridge emits `toolCallName: "subagent"`, [VERIFIED: src/bun/copilotkit/event-bridge.ts:234]). MCP/board tools (e.g., `create_card`, `record_decision`, `list_boards` — engine tool definitions) → default card.
**Note:** `TOOL_CALL_START` carries only `toolCallName` + args — the legacy `display.contentType` hint is NOT on the wire ([VERIFIED: event-bridge.ts:174-180]); renderers must dispatch on name (and args shape) alone. `TOOL_CALL_ARGS` arrives as one full-JSON delta, not chunked.

### Pattern 3: `#interrupt` slot + `useInterrupt` (D-06, Phase 3 contract)

**What:** `useInterrupt()` (no config needed) publishes the pending interrupt into the core; CopilotChat renders the `#interrupt` slot with props `{ event, interrupt, interrupts, result, resolve, cancel }`. For standard AG-UI interrupts (Phase 3 emits `RUN_FINISHED outcome:{type:"interrupt", interrupts:[…]}`), `event = { name: "on_interrupt", value: interrupts[0] }` (verified in bundle — the name constant is the legacy string; the value is the Interrupt object). `interrupt.metadata` = `DecisionRequestPayload { context?: string; questions: DecisionRequestQuestion[] }` ([VERIFIED: src/shared/rpc-types.ts:304-307]). `resolve(payload)` records `{status:"resolved", payload}` per interrupt and submits the whole `resume[]` array once all interrupts are addressed; `cancel()` records `{status:"cancelled"}` ([VERIFIED: hooks/use-interrupt.d.ts]).
**Resume payload contract** ([VERIFIED: src/bun/copilotkit/event-bridge.ts:380-422]): `{ decision: "approved"|"rejected", answers?: DecisionAnswer[], generalNotes?, recordAsDecisions? }` — a resolved resume MUST carry non-empty `answers` (else `INVALID_PAYLOAD`); `decision` is informational. Phase 3 D-02 maps `status:"cancelled"` → rejection. The card ports `DecisionRequest.vue` (`canSubmitDecisionRequest` from `utils/decisionRequest.ts:25-40`, weight labels, "AI suggests" badge, "Record as decisions" toggle — all verified).

### Pattern 4: `#input` slot wiring (D-07)

**What:** The `#input` slot receives `CopilotChatInputSlotProps = { modelValue, isRunning, inputMode, inputToolsMenu, onUpdateModelValue, onSubmitMessage, onStop?, onAddFile, onStartTranscribe, onCancelTranscribe, onFinishTranscribe, onFinishTranscribeWithAudio }`. Render `CopilotChatInput` inside it with `:model-value`, `:is-running`, `:tools-menu="inputToolsMenu"`, `:disabled="hasInterrupt"`, `@submit-message`, `@stop`, `@update:model-value`. `ToolsMenuItem = { label } & ({ action: () => void } | { action?: never; items: (ToolsMenuItem|"-")[] })` (nested submenus + separators supported, [VERIFIED: types.d.ts]). Build the menu from `useCommandsCache.getCommands(taskId)` / `getCommandsRef(taskId)` ([VERIFIED: composables/useCommandsCache.ts]) → `{ label: "/" + name, action: () => insert }`; `engine.listCommands` takes `{ taskId?: number; workspaceKey?: string }` ([VERIFIED: rpc-types.ts:991-994]) — sessions pass `workspaceKey` (legacy ChatEditor only wired taskId; session path is a small new call).
**Stop:** CopilotChatInput shows a stop control when `isRunning` and emits `stop`; the wrapper calls `agent.abortRun()` (AbstractAgent method, [VERIFIED: @ag-ui/client]) → runtime `POST /agent/:id/stop/:threadId` → `runner.stop()` → `agent.abortRun()` → `orchestrator.cancel`.

### Pattern 5: "Stopped" label = client state (D-08)

**What:** The server maps outcome `"aborted"` to a plain `RUN_FINISHED { result: null }` ([VERIFIED: src/bun/copilotkit/event-bridge.ts:318-328] — `terminalEvent("aborted")` returns `RUN_FINISHED` with no outcome field) — indistinguishable from a natural completion on the wire. The wrapper tracks `stopRequested = true` on stop click and shows a "Stopped" marker next to the last partial assistant message when the run ends (`agent.subscribe({ onRunFinalized })` or `isRunning` transition); cleared on next submit. Best-effort per engine (CHAT-11 hardening is v2).

### Anti-Patterns to Avoid

- **Providing a generic `#tool-call` slot for "simplicity":** it short-circuits `useDefaultRenderTool` for ALL tools, forcing a hand-rolled default card — violating D-04 and duplicating the shipped default (which already renders name/status/args/result with `data-testid="copilot-tool-render"`).
- **Mounting CopilotChat without `threadId`:** generates a random new thread each mount → history lost (CHAT-07) and welcome screen shows. Always pass `:thread-id="String(conversationId)"` (server rejects non-numeric threadIds with `THREAD_NOT_FOUND`, [VERIFIED: railyin-agent.ts:223-224]).
- **Reusing the legacy `#tool-call` slot props inside a v1-style per-tool component keyed by `toolCallId`:** the slot name must be `tool-call-${toolCallName}` exactly (template-literal slot type `[key: \`tool-call-${string}\`]`, [VERIFIED: CopilotChatToolCallsView.vue.d.ts]).
- **Importing `@copilotkit/vue/styles.css` globally without checking layout impact:** the stylesheet is 67KB of Tailwind v4 (layers base/components/utilities + `cpk:`-prefixed utilities); `@layer base` can leak preflight resets app-wide. Import it once (main.ts or RailyinChat) and verify no board-layout regressions.
- **Hand-rolling "Stopped"/"error" labels from wire events:** aborted runs and done runs are byte-identical terminals; only client-side stop state can label partials.
- **Trying to make the server emit `display.contentType` on the wire:** the wire contract is `toolCallName` only; renderers dispatch on the canonical name families.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Chat UI (messages, streaming, input, scroll) | Custom message list + editor | `CopilotChat` + `CopilotChatInput` | Verified installed API covers messages/streaming/input/toolsMenu/stop; the legacy ~8k-line stack is what we're retiring |
| Markdown rendering | Custom markdown → v-html pipeline | `StreamMarkdown` (streamdown-vue, inside CopilotChat) | Component-based AST rendering (no raw v-html), Shiki code blocks, tables/images, copy/download buttons — strictly safer than the legacy `marked` + `v-html` path |
| Default tool card | Custom generic tool card | `useDefaultRenderTool()` | Ships expandable card with name/status/args/result and `data-testid="copilot-tool-render"`; D-04 mandates it for non-domain tools |
| Interrupt/resume plumbing | Custom HITL channel | `useInterrupt()` + `#interrupt` slot + `resolve(payload)` | Handles the resume[] submission, all-interrupts-must-resolve, and renderInChat state publication; matches Phase 3's canonical contract |
| Slash-command menu | Custom autocomplete (legacy CodeMirror `slashCompletions`) | `CopilotChatInput` `toolsMenu` prop | Nested items + separators typed in `ToolsMenuItem`; items are plain `{label, action}` — trivially mapped from `useCommandsCache` |
| Thread history load | Custom message fetch on reopen | `threadId` prop → auto `connectAgent` replay | Verified: mount/switch with `threadId` POSTs `/connect` and replays JSONL (RUNR-05); the legacy `conversations.getMessages` paging is retired |
| Scroll-to-bottom / autoscroll | Custom virtualizer + scroll logic | CopilotChat `autoScroll` (`"pin-to-bottom"` default, `"pin-to-send"`, `"none"`) | Verified prop on CopilotChatViewProps |

**Key insight:** every "hard" piece of this phase — streaming reconciliation, tool-call lifecycle state, interrupt state machine, markdown safety, autoscroll — already ships inside the pinned package. The wrapper's job is *wiring + CSS parity + domain renderers*, not reimplementing chat machinery.

## Runtime State Inventory

> Phase 5 is a UI-surface swap (migration-adjacent): the chat *rendering* moves to CopilotKit while the old stack stays alive (D-10). Inventory of runtime state affected by the swap:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None renamed — JSONL threads (`data/threads/{id}.jsonl`) are the chat history source (unchanged); legacy `conversation_messages`/`stream_events` tables stay frozen (IMPR-02) | none — no data migration in this phase |
| Live service config | None — no external service config references the old chat UI; the CopilotRuntime mount (`/api/copilotkit`) is already live from Phases 1-4 | none |
| OS-registered state | None — no OS registrations involved (web app only) | none |
| Secrets/env vars | None — no secret names change; CopilotKitProvider takes NO publicApiKey/licenseToken (verified provider props; local-first) | none |
| Build artifacts | `dist/` rebuild required for UI e2e (`bun run build` before `test:e2e` — Playwright serves dist/); new `src/mainview/components/chat/*` compile into the normal bundle | rebuild; no stale-artifact cleanup (old components remain part of the bundle by design until Phase 7) |

**Nothing found in category:** Stored data / Live service config / OS-registered state / Secrets — verified by the reads above (rpc-types thread tables, src/bun/index.ts mount, provider props).

## Common Pitfalls

### Pitfall 1: Tool-call slots silently not matching
**What goes wrong:** Domain tools render as raw JSON default cards (or the default card) despite the renderers existing.
**Why it happens:** Slot names must be exactly `tool-call-${toolCallName}` and `toolCallName` is engine-specific (`bash` vs `run` vs `shell` across pi/claude/copilot/cursor/opencode). If RailyinChat declares only `#tool-call-bash`, the pi engine's `run` tool falls through.
**How to avoid:** Declare slots for ALL canonical family names (verified list in Pattern 2); keep a unit test mapping family-name → slot name; accept the default card for genuinely unknown tools (D-04 default).
**Warning signs:** A tool card in the UI with no custom rendering while `#tool-call-*` slots exist.

### Pitfall 2: Welcome screen / empty flash on thread mount
**What goes wrong:** "How can I help you today?" flashes before history renders, or a new random thread replaces the conversation on re-render.
**Why it happens:** Without an explicit `threadId`, CopilotChat generates a new thread id; the welcome screen shows while connect is in flight.
**How to avoid:** Always pass `:thread-id` (numeric conversation id string) and `hasExplicitThreadId`/`isConnecting` as needed; the empty-thread state ("No messages yet" + input enabled) is the wrapper's own render per UI-SPEC copywriting contract.
**Warning signs:** History missing after reopening a card; a fresh thread id on the server after a page refresh.

### Pitfall 3: "Stopped"/"error" labels can't be derived from the wire
**What goes wrong:** Partial responses after stop render identically to completed ones; error tool cards show spinners forever.
**Why it happens:** Aborted runs emit a plain `RUN_FINISHED` (verified) and replayed tool calls synthesize results (RUNR-07) — neither carries a stop marker.
**How to avoid:** Track `stopRequested` client-side in RailyinChat; label the last partial message when the run finalizes after a stop. Error tool cards: `status` slot prop is `"complete"` for errored tool calls too — if the app needs a red "failed" state, the domain renderer must inspect `result` content or the wrapper must accept the default-card behavior (UI-SPEC backstop row).
**Warning signs:** "Stopped" label logic keyed off `RUN_FINISHED.outcome` (it's absent).

### Pitfall 4: CopilotKit styles.css leaking app-wide
**What goes wrong:** Board layout shifts, fonts change, unexpected resets after importing `@copilotkit/vue/styles.css`.
**Why it happens:** 67KB Tailwind v4 stylesheet with `@layer base` (preflight) + utilities, imported globally.
**How to avoid:** Import once; verify board/terminal/drawer rendering after the import; keep RailyinChat's own overrides in a non-scoped style block scoped to the chat root class; use `--p-*` tokens (UI-SPEC token contract).
**Warning signs:** `git diff` shows layout snapshots changed in unrelated spec runs.

### Pitfall 5: Legacy stores still driving the chat UI
**What goes wrong:** Double-rendering (legacy bubbles + CopilotChat messages) or board events resurrecting the old message list.
**Why it happens:** `App.vue` currently routes `stream.event`/`message.new` pushes into `conversationStore`/`chatStore`, and TaskChatView/SessionChatView render from those stores.
**How to avoid:** The swap must (a) stop rendering `ConversationBody`/`ConversationInput` in the Chat tabs (replace with RailyinChat), (b) keep the stores' push handlers alive for board/session chrome (unread dots, session status) — but RailyinChat must NOT read `conversationStore.messages`. Legacy code stays but is unreachable from the chat surfaces (D-10).
**Warning signs:** Old `.msg--user` elements alongside CopilotChat bubbles; chat re-renders on /ws pushes.

### Pitfall 6: Sidebar data contract mismatch (status/unread)
**What goes wrong:** The UI-SPEC `ChatThreadSidebar` requires status dots and unread dots, but `ThreadSummary` has no status/unread fields.
**Why it happens:** `threads.list` (Phase 4) returns `{threadId, name, kind, createdAt, updatedAt}` only ([VERIFIED: rpc-types.ts:111-121]).
**How to avoid:** Enrich the list from the legacy `chatSessions.list` (still live, has status/lastReadAt) for session threads; card threads have no unread concept in the legacy model — decide the v1 behavior (see Open Questions). Do NOT silently invent fields on ThreadSummary without a backend change.
**Warning signs:** Sidebar dots never light up; TypeScript errors on `.status` access.

## Code Examples

Verified patterns from the installed package and the codebase:

### Provider mount (App.vue — [VERIFIED: CopilotKitProvider.types.d.ts])
```vue
<script setup lang="ts">
import { CopilotKitProvider } from "@copilotkit/vue/v2";
// in template, wrapping <RouterView />:
</script>
<template>
  <CopilotKitProvider runtime-url="/api/copilotkit">
    <RouterView />
  </CopilotKitProvider>
</template>
<!-- import "@copilotkit/vue/styles.css" once (main.ts or App.vue) -->
```

### RailyinChat wrapper skeleton (props/slots verified from CopilotChat.vue.d.ts)
```vue
<template>
  <CopilotChat
    :thread-id="threadId"              <!-- String(conversationId) — auto-connect + replay (CHAT-07) -->
    :input-tools-menu="toolsMenu"      <!-- from useCommandsCache (CHAT-06) -->
    :input-value="inputValue"
    :welcome-screen="false"
    class="railyn-chat"
    @stop="onStop"
  >
    <!-- Decision card (D-06) — slot props verified: {event, interrupt, interrupts, result, resolve, cancel} -->
    <template #interrupt="{ event, interrupt, resolve, cancel }">
      <DecisionInterrupt :interrupt="interrupt" @submit="(p) => resolve(p)" @cancel="() => cancel()" />
    </template>

    <!-- Domain renderers (D-04) — slot name MUST be `tool-call-${toolCallName}` -->
    <template #tool-call-subagent="{ name, args, status, result }">
      <DelegateSummaryRenderer :args="args" :status="status" :result="result" />
    </template>
    <template #tool-call-bash="{ args, status, result }">
      <ShellOutputRenderer :args="args" :status="status" :result="result" />
    </template>
    <template #tool-call-run="{ args, status, result }">
      <ShellOutputRenderer :args="args" :status="status" :result="result" />
    </template>
    <!-- …run_in_terminal, read/read_file/view, write/write_file/create/edit/multiedit/apply_patch… -->

    <!-- Input (D-07) — CopilotChatInput slot props verified -->
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
useDefaultRenderTool();          // default card for all non-domain tools (D-04)
const { hasInterrupt } = useInterrupt();  // publishes interrupt → #interrupt slot (no handler needed)
const { agent } = useAgent({ agentId: "default" });
function onStop() { stopRequested.value = true; agent.value?.abortRun(); }
</script>
```

### Tool-call slot resolution order (verified from compiled bundle — do not reimplement)
```
toolCallName → #tool-call-<name> slot  →  #tool-call slot  →  registered renderers (useRenderTool/useDefaultRenderTool/provider renderToolCalls)
```

### Decision interrupt data shape (verified)
```ts
// #interrupt slot props: { event: { name: "on_interrupt", value: Interrupt }, interrupt: Interrupt, interrupts: Interrupt[], result, resolve, cancel }
// Interrupt = { id, reason: "decision_request", message?, metadata?: Record<string, any> }   [VERIFIED: @ag-ui/core InterruptSchema]
// metadata = DecisionRequestPayload = { context?: string; questions: DecisionRequestQuestion[] }  [VERIFIED: rpc-types.ts:304-307]
// resolve({ decision: "approved", answers, generalNotes, recordAsDecisions }) → resume[] → POST /run  [VERIFIED: event-bridge.ts:380-422]
```

### toolsMenu from useCommandsCache (CHAT-06)
```ts
import { getCommandsRef } from "../composables/useCommandsCache";
import type { ToolsMenuItem } from "@copilotkit/vue/v2";
const menu = computed<ToolsMenuItem[]>(() =>
  (taskId != null ? getCommandsRef(taskId).value : sessionCommands.value).map((c) => ({
    label: `/${c.name}`,
    action: () => { inputValue.value += `/${c.name}`; },
  })),
);
```

### MockAgui extension for connect/stop (e2e — current fixture only handles run + info; 404s everything else)
```ts
// POST /api/copilotkit/agent/:agentId/connect → SSE replay body (mirror railyin-runner replay shape:
// RUN_STARTED + historic events (+ synthesized TOOL_CALL_RESULTs) + MESSAGES_SNAPSHOT + RUN_FINISHED;
// never-run thread → empty 200 SSE, per RUNR-06).
// POST /api/copilotkit/agent/:agentId/stop/:threadId → { success: true }
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Custom `StreamEvent` WS protocol + dual-layer conversation store (~8k lines) | AG-UI events over SSE via CopilotRuntime (`/api/copilotkit/*`) | Phases 1-4 (backend), Phase 5 (frontend swap) | Chat moves off /ws entirely; /ws keeps only board events |
| Legacy interrupt mechanics (`on_interrupt` custom event + `forwardedProps.command.resume`) | Standard `RUN_FINISHED outcome:{type:"interrupt"}` + `RunAgentInput.resume[]` | Phase 3 (all-canonical D-01) | Client `useInterrupt`/`#interrupt` slot consumes the standard shape; legacy channels inert (e2e test 16) |
| `useThreads` for thread lists | Own `threads.list` RPC over JSONL index | Phase 4 | Self-hosted runtimes don't serve thread endpoints; own endpoint is the reliable path (STACK.md) |
| React-only CopilotKit | Official Vue 3 port (`@copilotkit/vue`, v2 subpath, slots-first API) | June 2026 (merged upstream) | Vue slots are the primary customization model; `renderCustomMessages` is the provider-level alternative — no new provider APIs to invent |

**Deprecated/outdated:**
- **`useThreads` (both React and Vue):** errors "thread endpoints unavailable" on self-managed runtimes — do not attempt; own endpoint only.
- **`useHumanInTheLoop`:** for LLM-initiated pauses via client-side *tools*; Railyin's decision channel is a deterministic server checkpoint → `useInterrupt` is the correct composable (STACK.md).
- **CopilotKit v1 APIs:** `@copilotkit/vue` v1 exports and legacy thread props predate AG-UI; everything imports from `/v2`.
- **`forwardedProps.command.resume`:** deprecated by the AG-UI spec; Phase 3 D-01 forbids it; Phase 5 must not send it.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | The "Stopped" label is implemented as wrapper-local state (`stopRequested` + run-finalize watch) rather than any CopilotKit built-in indicator | Patterns/Pitfall 3 | Wire offers no aborted marker (verified); if CopilotKit later adds one, the label logic would need adjusting — low impact |
| A2 | `styles.css` `@layer base` preflight leaks app-wide and needs a mitigation check at import time | Pitfall 4 | If it doesn't leak, the mitigation step is a no-op; if it does and we skip it, board layout regresses |
| A3 | Sessions' slash-command menu uses `engine.listCommands({ workspaceKey })` (untested in legacy UI, which only wired taskId) | Pattern 4 | If sessions need taskId-scoped commands, the menu falls back to an empty list — acceptable v1, matches legacy (ChatEditor skipped slash completions for sessions) |
| A4 | MCP/board tools (create_card, record_decision, list_* etc.) render via the default card; no per-tool slots for them | Pattern 2 | Cosmetic only — D-04 explicitly accepts the default card for generic tools |
| A5 | The `#input` slot override is required only for `:disabled="hasInterrupt"` + custom chrome; default CopilotChatInput is otherwise feature-complete for this phase (multiline, toolsMenu, stop) | Pattern 4 | If CopilotChatInput's default slot wiring is sufficient, the override still works as-is — low risk |
| A6 | `katex` CSS auto-loads via `useKatexStyles` (hook exists; warning string "katex styles — math content may render without formatting" seen in bundle) | Stack | Math rendering may be unformatted until the hook/CSS import is confirmed — cosmetic, not in phase scope |
| A7 | UI-SPEC unresolved rows are planner must-have assumptions: queue dropped (input disabled while running), resume-failure = toast + card stays open, CSS override depth = RailyinChat single surface + visual diff, args reveal at END only | Constraints | Each has an explicit UI-SPEC planner instruction to lift into must_haves |
| A8 | The unread/status dots in ChatThreadSidebar are enriched from the legacy `chatSessions.list` (still live) for session threads; card threads show no unread dot in v1 | Pitfall 6 | If a backend `ThreadSummary` extension is preferred instead, it's a small Phase 4/5 follow-up RPC change — decide in planning |

## Open Questions

1. **ChatThreadSidebar data source for status/unread dots (UI-SPEC contract vs ThreadSummary shape)**
   - What we know: `threads.list` → `ThreadSummary {threadId, name, kind, createdAt, updatedAt}` (no status/unread); legacy `chatSessions.list` has status/lastReadAt and keeps working (tables frozen, not dropped); legacy ChatSidebar renders exactly the session list.
   - What's unclear: whether the new sidebar lists only sessions (as today) or also card threads, and where status/unread come from.
   - Recommendation: list sessions via `chatSessions.list` (existing store/behavior, zero backend change) for v1, with `threads.list` as the card-thread source if card threads must appear; treat unread/status dots as session-only. Flag for the discuss/plan split if the user wants card threads in the sidebar.

2. **How strongly to enforce "old UI not rendering" (D-10)**
   - What we know: TaskChatView/SessionChatView Chat tabs and ChatSidebar are the only render sites ([VERIFIED]); ConversationDrawer mounts the two views; ConversationPanel is a standalone fallback not used in the drawer.
   - What's unclear: whether to keep the legacy components mounted-but-hidden (risky double effects) or swap the template branches outright (cleaner, still rollback-able via git).
   - Recommendation: template-branch swap (v-if) to RailyinChat in the Chat tabs; leave every legacy file untouched on disk.

3. **"Stopped" label placement**
   - What we know: label must appear on the partial assistant message (UI-SPEC backstop row, verification: backstop).
   - What's unclear: exact rendering slot (last message meta row vs a status chip below the message list) and whether the label survives thread switch.
   - Recommendation: render a "Stopped" chip in the message area when `stopRequested && !isRunning`, cleared on next submit; hold-out visual state test per UI-SPEC.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Bun | dev server, tests, scripts | ✓ | 1.4.0 | — |
| Node | vite build, playwright | ✓ | v20.20.1 | — |
| Playwright | e2e/ui specs | ✓ | 1.59.1 | — |
| @copilotkit/vue | chat surface | ✓ | 1.66.4 (installed, pinned) | — |
| vite | build (dist/) | ✓ | 6.x (devDep) | — |
| PrimeVue/Aura + PrimeIcons + Iconify | design tokens/chrome | ✓ | 4.x / 7.x / 5.x | — |

**Missing dependencies with no fallback:** none — all libraries are already installed and pinned; this phase adds zero new packages.

## Validation Architecture

`workflow.nyquist_validation: true` (config.json) — section applies.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 3 (frontend unit via `bun test src/mainview`; backend via `vitest.backend.config.ts` pool:forks) + Playwright 1.59.1 (UI e2e against `dist/` via `vite preview`, all backend mocked) |
| Config file | `vitest.config.ts` (aliases `@`→src/mainview, `@shared`→src/shared) / `playwright.config.ts` (port 4100-4999 derived from workdir) |
| Quick run command | `bun test src/mainview --timeout 20000` (frontend unit) |
| Full suite command | `bun run test:e2e` (builds first; UI specs) + `bun test src/bun --timeout 20000` (backend) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CHAT-01 | Token-by-token streaming renders | e2e | new spec `e2e/ui/chat-copilotkit.spec.ts` (MockAgui SSE) | ❌ Wave 0 |
| CHAT-02 | Markdown + code parity | unit + e2e | renderer component test + spec assertion on `pre`/code styles | ❌ Wave 0 |
| CHAT-03 | Tool cards expandable with name/status/args/result | e2e | spec asserts `[data-testid="copilot-tool-render"]` / tool-card-{id} + domain renderers | ❌ Wave 0 |
| CHAT-04 | Stop → partial labeled "Stopped" | e2e (backstop) | spec: send → stop-btn → assert "Stopped" marker; explicit held-out visual state evidence at verify | ❌ Wave 0 |
| CHAT-05 | Reasoning card renders | e2e | spec: MockAgui SSE with REASONING_MESSAGE_* → collapsed "Thinking" indicator | ❌ Wave 0 |
| CHAT-06 | toolsMenu lists commands; action inserts | unit + e2e | unit: `useCommandsCache`→ToolsMenuItem mapping (pure fn); e2e: open menu, click item | ❌ Wave 0 |
| CHAT-07 | Reopen shows full history | e2e | spec: connect mock replays events → messages render; second open replays again | ❌ Wave 0 |
| UI-01 | Chat surfaces swapped, layout preserved | e2e + visual | spec: task drawer Chat tab shows CopilotChat; header/tabs unchanged | ❌ Wave 0 |
| UI-02 | Domain renderers (shell/file/delegate) | unit | `ShellOutputRenderer/FileChangesRenderer/DelegateSummaryRenderer` component tests (truncation, stats, details) | ❌ Wave 0 |
| UI-04 | Board /ws reactivity intact | e2e | existing `board-ws-updates.spec.ts` stays green (regression) | ✅ exists |
| IMPR-03 | Legacy stack alive | code-review/assertion | no delete in diff; optionally a spec asserting legacy files render nothing | manual |

### Sampling Rate
- **Per task commit:** `bun test src/mainview --timeout 20000`
- **Per wave merge:** `bun run test:e2e` (full UI suite) + `bun test src/bun --timeout 20000`
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `e2e/ui/fixtures/mock-agui.ts` — add `POST /agent/:agentId/connect` (replay SSE; empty for never-run threads) and `POST /agent/:agentId/stop/:threadId` routes; wire `MockAgui` into `e2e/ui/fixtures/index.ts` for the new specs only (legacy specs untouched)
- [ ] `e2e/ui/chat-copilotkit.spec.ts` — new streaming/tool-card/stop/reasoning/slash/history specs (Phase 5 owns new-suite creation; full 55-spec migration is Phase 6/VERF-02)
- [ ] Unit tests for `tool-call-renderers/*` + the toolsMenu mapping helper + DecisionInterrupt payload mapping

## Security Domain

`workflow.security_enforcement: true`, `security_asvs_level: 1` (config.json) — section applies.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Local-first single-user app; no auth surface (consistent with Phases 1-4 research) |
| V3 Session Management | no | No sessions; thread identity = numeric conversation.id string |
| V4 Access Control | no | Same-origin single user; runtime mount already guards cross-origin POSTs (WR-03, e2e test g) |
| V5 Input Validation | yes | Server: `RunAgentInputSchema` zod validation + `translateResumeToSubmission` validates resume payloads ([VERIFIED: event-bridge.ts:402-422]); client: no new trust boundary — renderers treat args/result as display data |
| V6 Cryptography | no | Localhost HTTP; no secrets on the wire (no publicApiKey/licenseToken — verified provider props allow omitting them) |

### Known Threat Patterns for {stack}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| XSS via agent-rendered markdown/tool output | Tampering | `StreamMarkdown` renders markdown as components, not `v-html` (verified: no innerHTML/v-html in streamdown-vue dist) — strictly safer than the legacy `marked`+`v-html` path (MessageBubble.vue:8,13); keep the ported renderers on component rendering, never re-introduce `v-html` for raw assistant/tool content |
| Prototype pollution / JSON injection via tool args | Tampering | Args arrive as JSON strings validated server-side (`TOOL_CALL_ARGS` delta); renderers use `useToolResultDisplay`'s defensive parse (try/catch fallback to raw) |
| SSRF/unauthorized runtime use | Spoofing | Runtime mount already rejects cross-origin POSTs with 403 (WR-03 verified in e2e/api); no new surface added this phase |
| Resume payload tampering | Tampering | `translateResumeToSubmission` validates every answer element shape before delegation ([VERIFIED: event-bridge.ts:412-422]); malformed → INVALID_PAYLOAD |

## Sources

### Primary (HIGH confidence — read this session)
- Installed package types: `node_modules/@copilotkit/vue/dist/v2/` — `components/chat/CopilotChat.vue.d.ts`, `CopilotChatInput.vue.d.ts`, `CopilotChatToolCallsView.vue.d.ts`, `CopilotChatView.vue.d.ts`, `components/chat/types.d.ts` (CopilotChatProps, ToolsMenuItem, slot prop interfaces), `hooks/use-interrupt.d.ts`, `hooks/use-agent.d.ts`, `hooks/use-default-render-tool.d.ts`, `hooks/use-render-tool.d.ts`, `types/interrupt.d.ts`, `types/defineToolCallRenderer.d.ts`, `providers/CopilotKitProvider.types.d.ts`, `providers/useCopilotChatConfiguration.d.ts`
- Installed package bundle: `node_modules/@copilotkit/vue/dist/use-render-activity-message-CaArNmtw.js` (slot precedence, interrupt wiring, threadId→connectAgent, useInterrupt internals, StreamMarkdown import, default renderer `data-testid="copilot-tool-render"`)
- `node_modules/@copilotkit/core/dist/index.mjs` (connect/streaming), `node_modules/@ag-ui/client/dist/index.d.mts` (AbstractAgent: isRunning/connectAgent/abortRun/detachActiveRun, AgentSubscriber), `node_modules/@ag-ui/core/dist/index.d.mts` (InterruptSchema, RunFinishedOutcome)
- Codebase: `src/shared/rpc-types.ts` (ThreadSummary:111-121, ImportSummary:127-133, ToolCallDisplay:236-247, DecisionRequestPayload:304-307, threads.list:1109-1112, legacyImport.run:1116-1119, engine.listCommands:991-994), `src/bun/copilotkit/event-bridge.ts` (tool events:160-239, terminalEvent:318-328, buildInterruptOutcome:342-378, resume contract:380-422), `src/bun/copilotkit/railyin-agent.ts` (numeric threadId:223-224, abort routing:101-102), `src/bun/engine/tool-display.ts` (canonical name families:19-49), `src/bun/engine/types.ts` (tool_start shape:23), `src/bun/handlers/threads.ts` + `legacy-import.ts`, `src/mainview/App.vue`, `src/mainview/main.ts`, `src/mainview/rpc.ts`, `src/mainview/views/BoardView.vue:154-213`, `src/mainview/components/{ConversationDrawer,TaskChatView,SessionChatView,ChatSidebar,ConversationBody,ConversationPanel,MessageBubble,ToolCallBlock,SubagentBlock,ReasoningBubble,DecisionRequest,ConversationInput,ChatEditor}.vue`, `src/mainview/composables/{useCommandsCache,useMarkdown,useToolResultDisplay}.ts`, `src/mainview/utils/{toolCallDisplay,decisionRequest}.ts`, `src/mainview/stores/chat.ts`, `e2e/ui/fixtures/{mock-api,mock-agui,mock-ws,index,helpers}.ts`, `e2e/api/copilotkit/{probe-agent,railyin.test}.ts`, `vitest.config.ts`, `vitest.backend.config.ts`, `playwright.config.ts`, `vite.config.ts`, `package.json`

### Secondary (MEDIUM confidence — prior project research, consistent with this session's verification)
- `.planning/research/{ARCHITECTURE,STACK,FEATURES,PITFALLS,SUMMARY}.md` — runner contract, interrupt/resume canonical flow, useThreads capability gating, stack pins
- `.planning/phases/03-decision-interrupts-resume/03-CONTEXT.md` — Phase 3 D-01..D-09 interrupt contract
- `.planning/phases/05-chat-ui-replacement-vue/05-CONTEXT.md` + `05-UI-SPEC.md` — locked decisions and design contract
- `e2e/api/copilotkit/pins.test.ts` — pin-lock test (exact versions)

### Tertiary (LOW confidence)
- None used — all claims verified against the installed package or read source files this session; no web-search claims were needed.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — versions and API surface verified from installed package.json + type definitions + npm registry
- Architecture: HIGH — thread wiring, slot precedence, interrupt flow, stop semantics verified from bundle/code; only the sidebar data-source question (Open Question 1) is a planning decision
- Pitfalls: HIGH — each pitfall traces to a verified wire/API fact (slot name matching, terminal shape, stylesheet size, store coupling)

**Research date:** 2026-08-09
**Valid until:** ~2026-09-08 (30 days — early-access CopilotKit Vue is fast-moving; re-verify API surface if the pin changes)
