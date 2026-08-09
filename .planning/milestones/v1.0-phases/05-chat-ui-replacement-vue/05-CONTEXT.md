# Phase 5: Chat UI Replacement (Vue) - Context

**Gathered:** 2026-08-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase swaps the board's hand-rolled chat UI for CopilotKit Vue v2 components (`CopilotChat` + slots, `CopilotChatInput`) wrapped in thin local components, delivering streaming chat, markdown/code at parity, tool-call cards (default + domain renderers for shell/file/delegate), reasoning display, slash commands + `/prompt-name` refs, full history via threads, and the decision-card interrupt slot (Phase 3 contract). The old chat stack code stays alive for rollback (IMPR-03) until Phase 6 E2E passes; board `/ws` reactivity (task.updated, code.ref, lsp) keeps working alongside the CopilotKit connection. Deliberately NOT in scope: regenerate/retry (v2, CHAT-10), cancel hardening (v2), thread list niceties (v2), attachments (v3).

</domain>

<decisions>
## Implementation Decisions

### Component Architecture (UI-01)
- **D-01:** Adopt `CopilotChat` + `CopilotChatInput` (CopilotKit Vue v2, pinned 1.66.4) inside thin local wrapper components (early-access SDK isolation — PROJECT.md constraint). Slots used: `#interrupt` (decision cards), `#tool-call-*`/`#tool-call` (domain renderers), `#input` (slash-command affordances), message slots as needed.
- **D-02:** The board layout regions (ChatSidebar / TaskChatView / SessionChatView equivalents) are preserved — the swap happens inside the existing chat surfaces; board /ws reactivity is untouched (UI-04).
- **D-03:** Thread wiring: card chat = thread with conversation.id; session chat = thread without taskId (Phase 2 mapping). Reopening any card/session shows full history (CHAT-07) — connect replays from JSONL (Phase 2/4).

### Tool-Call Cards (UI-02, CHAT-03)
- **D-04:** Default expandable card via `useDefaultRenderTool` (name, status, args, result); domain renderers ported from legacy (shell output, file changes, delegate task summaries) as `#tool-call-*` slots — never raw JSON cards for the domain tools.
- **D-05:** Replayed tool calls show completed state (Phase 2 TOOL_CALL_RESULT synthesis) — no stale "running" cards.

### Decision Cards (Phase 3 contract)
- **D-06:** The `#interrupt` slot renders the ported decision card (DecisionRequest → DecisionInterrupt), wired to `useInterrupt` resolve/cancel; contract: RUN_FINISHED interrupt outcome + resume[] (Phase 3 D-01..D-09). "Submit Decision" CTA per UI-SPEC.

### Slash Commands & Prompts (CHAT-06)
- **D-07:** `CopilotChatInput` toolsMenu provides slash-command affordance wired to the existing command registry; `/prompt-name` refs at parity (ref must be the entire leading value — AGENTS.md convention).

### Stop & Reasoning (CHAT-04, CHAT-05)
- **D-08:** Stop control: `isRunning` prop + runner stop (Phase 2 abortRun→cancel); partial responses labeled "Stopped" (UI-SPEC covered row; best-effort per-engine).
- **D-09:** Reasoning display zero-config (`CopilotChatReasoningMessage`-equivalent) — pi thinking flows through (Phase 2 bridge REASONING_*).

### Rollback & Verification (IMPR-03)
- **D-10:** Old chat stack code stays alive (not deleted, not imported) until Phase 6 E2E passes; this phase only stops the old UI from rendering in the chat surfaces.

### the agent's Discretion
- Exact wrapper component names/structure (thin local components around CopilotChat/CopilotChatInput).
- CSS override depth for markdown/code parity (UI-SPEC unresolved row) — planner/researcher picks the `:deep` strategy.
- Queue-dropped behavior and resume-failure UX (UI-SPEC unresolved rows) — acceptable v1 behaviors per UI-SPEC.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### UI Design Contract (MANDATORY)
- `.planning/phases/05-chat-ui-replacement-vue/05-UI-SPEC.md` — the APPROVED design contract: design system (PrimeVue 4 Aura tokens), spacing/typography/color/copywriting contracts, component inventory, and ## UI Considerations (29 covered + 2 backstop + 4 unresolved rows the planner lifts into must_haves).

### Research (produced this project)
- `.planning/research/FEATURES.md` — streaming/markdown/tool cards/reasoning/slash commands/regenerate-P2, anti-features (frontend tools, attachments).
- `.planning/research/ARCHITECTURE.md` — CopilotKit Vue component/slot inventory, connect replay, threadId mapping.
- `.planning/research/STACK.md` — @copilotkit/vue pin, early-access guidance, thin wrappers.
- `.planning/research/SUMMARY.md` — Phase 5 = "Chat UI Replacement (Vue)" (big-bang swap; rollback needs old code alive).

### Project documents
- `.planning/PROJECT.md` — CopilotKit pin, thin wrappers, decision UX, legacy-import button.
- `.planning/REQUIREMENTS.md` — CHAT-01..07, UI-01..04, IMPR-03.
- `.planning/ROADMAP.md` §Phase 5 — 5 success criteria.

### Codebase (integration points)
- `src/mainview/views/BoardView.vue` + `src/mainview/components/{ChatSidebar,TaskChatView,SessionChatView,ConversationPanel,ConversationInput,ChatEditor,MessageBubble,ToolCallBlock,ReasoningBubble,SubagentBlock,DecisionRequest}.vue` — the legacy surfaces being swapped/ported.
- `src/mainview/stores/conversation.ts` + `chat.ts` — legacy dual-layer store (preserved for board events; chat moves to CopilotKit client state).
- `src/mainview/rpc.ts` — WS push dispatch (board events stay; chat push moves to CopilotKit connection).
- `src/mainview/composables/useCommandsCache.ts` — slash-command registry to wire into toolsMenu.
- `src/mainview/App.vue` — provider mounting point (CopilotKitProvider).
- `e2e/ui/fixtures/mock-api.ts` + `mock-agui.ts` — Phase 1 validated AG-UI fixtures for UI e2e.
- `.planning/phases/03-decision-interrupts-resume/03-CONTEXT.md` — interrupt slot contract (D-01..D-09).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Legacy renderers to port: `ToolCallBlock.vue` (truncation), `SubagentBlock.vue` (delegate summaries), `DecisionRequest.vue` (decision card), `ReasoningBubble.vue`, `MessageBubble.vue` (markdown via `useMarkdown`), `ConversationInput.vue` (slash chips).
- `useCommandsCache.ts` — slash-command registry (toolsMenu wiring).
- `useMarkdown.ts` composable — markdown rendering (parity).
- `mock-agui.ts` fixture (Phase 1) — validated AG-UI SSE mocks for UI e2e.
- `useBoardSyncHandler.ts` — /ws board reactivity (must keep working — UI-04).

### Established Patterns
- Thin presentational components + Pinia stores; composables extract reusable behavior.
- `data-testid` conventions (UI-SPEC).
- PrimeVue 4 Aura tokens + `.dark-mode` handling.
- E2E: UI specs mock backend via `page.route()` (mock-api.ts + mock-agui.ts) — never a real Bun server.

### Integration Points
- `App.vue` — CopilotKitProvider mount (runtime-url → /api/copilotkit).
- `BoardView.vue` / TaskChatView / SessionChatView — where CopilotChat replaces legacy chat.
- `rpc.ts` — board push handlers remain; chat wire moves to CopilotKit client.

</code_context>

<specifics>
## Specific Ideas

- Success criterion 1: token-by-token streaming with markdown + code at parity with the old editor (UI-SPEC covered row; CSS override strategy is a planner unresolved row).
- Success criterion 2: tool cards with domain renderers for shell/file/delegate (D-04).
- Success criterion 3: stop propagates best-effort, partial labeled "Stopped" (D-08).
- Success criterion 4: slash commands + prompt refs parity; full history on reopen (D-03, D-07).
- Success criterion 5: /ws intact + old stack alive for rollback (D-10).

</specifics>

<deferred>
## Deferred Ideas

- Regenerate/retry — v2 (CHAT-10); JSONL replay fallback if Vue API unconfirmed.
- Cancel hardening per-engine — v2 (CHAT-11).
- Thread list UI (rename/archive/delete) — v2 (CHAT-13).
- Attachments — v3 (CONT-01).
- Suggestions (useConfigureSuggestions) — v2 (CHAT-12).

</deferred>

---

*Phase: 5-Chat UI Replacement (Vue)*
*Context gathered: 2026-08-09*
