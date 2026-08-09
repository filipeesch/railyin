# Phase 7: Cleanup & Feature Trim - Context

**Gathered:** 2026-08-09
**Status:** Ready for planning

<domain>
## Phase Boundary

This phase deletes the hand-rolled chat stack now that the CopilotKit swap is proven: the custom StreamEvent protocol + stream-tree machinery, the legacy conversation/chat stores and UI components (dead since Phase 5 — zero importers verified in Phase 6), the CodeMirror editor, and the trimmed features (file_diff, code_review, transition_event, status/status_chunk, usage display, compaction_summary, ask_user, shell_approval — the RPC surfaces, event types, renderers, and any dead executor paths). Old SQLite chat tables stay frozen (never dropped, no new writes). The legacy import is retired behind a flag. Build + all suites must stay green after deletion (Phase 6's 517/0 baseline).

</domain>

<decisions>
## Implementation Decisions

### Deletion Scope (success criterion 3)
- **D-01:** Delete the dead chat stack: `src/shared/stream-tree.ts` + StreamEvent protocol types (the AG-UI protocol replaced them), legacy chat components (ChatSidebar, ConversationPanel, ConversationBody, ConversationInput, ChatEditor, MessageBubble, ToolCallBlock, ReasoningBubble, SubagentBlock, TransitionEventCard, McpToolsPopover, ContextPopover, InlineChipText, FileDiff, ReadView, etc. — the Phase 6-verified dead chain), and the legacy conversation/chat Pinia store layers that only served chat streaming (keeping board/task/notes/etc.).
- **D-02:** Trim the removed features' backend surfaces: `file_diff`, `code_review`, `transition_event`, `status`/`status_chunk`, `usage` display, `compaction_summary`, `ask_user`, `shell_approval` — delete event types, RPC methods, renderers, and any dead executor paths (code-review-executor, file-state-cache, bash-permission-gate per PROJECT.md). Verify each trim's RPC/event is unreferenced before deletion (Phase 6's retire evidence is the guide).
- **D-03:** Keep the markClaudeExecution double-broadcast hack deletion for THIS phase (Phase 2 deferred it here) — the bridge is the single translation path now that the legacy /ws chat push is gone.

### Frozen Tables (success criterion 2)
- **D-04:** Old chat tables (`conversation_messages`, `stream_events`, `chat_sessions`-chat columns, `model_raw_messages`?) stay frozen — NOT dropped; no new writes after this phase. The importer (Phase 4) still reads them (frozen = read-only).
- **D-05:** Verify zero new writes: after the swap, no code path writes to the old chat tables (grep + runtime check via the retention/stream pipeline removal).

### Import Retirement (success criterion 4)
- **D-06:** Legacy import retires behind a flag once imports are complete — the `legacyImport.run` RPC + import button hide behind a config/env flag (e.g., `RAILYN_LEGACY_IMPORT=1` or config key); the import module + its reads stay available but off by default.

### Verification (success criteria 1+3)
- **D-07:** Post-deletion gate: `git grep` zero references to the custom StreamEvent protocol and deleted modules; build + full Playwright suite + e2e/api + src/bun + typecheck all green (Phase 6 baseline 517/0 must hold).

### the agent's Discretion
- Exact file inventory for deletion (planner verifies zero-import status per file before listing).
- Whether the importer flag is env-var or config-key.
- Retention/cleanup of `stream_events`-writing pipeline code (WriteBuffer paths) vs keeping for board events — planner verifies what's still live.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Research (produced this project)
- `.planning/research/FEATURES.md` — trimmed-feature list (anti-features), tool-renderer replacement note.
- `.planning/research/ARCHITECTURE.md` — legacy stack inventory (conversation/, stream/, stores), what the swap replaced.
- `.planning/research/SUMMARY.md` — Phase 7 = "Cleanup & Feature Trim" (deliberately last; removes StreamEvent protocol and trimmed features; freezes old tables).

### Project documents
- `.planning/PROJECT.md` — Active trim items (file_diff, code_review, transition_event, status/status_chunk, usage display, compaction_summary, ask_user, shell_approval), rollback notes, frozen-table constraint.
- `.planning/REQUIREMENTS.md` — IMPR-03 discharge (rollback window closed by Phase 6).
- `.planning/ROADMAP.md` §Phase 7 — 4 success criteria.

### Codebase (integration points)
- `src/shared/stream-tree.ts` + `rpc-types.ts` (StreamEvent/type removal).
- `src/mainview/components/` — the dead legacy chat chain (Phase 6-verified zero-importers).
- `src/mainview/stores/conversation.ts` + `chat.ts` — legacy chat store layers.
- `src/bun/engine/execution/{code-review-executor,retry-executor}.ts`, `src/bun/engine/claude/file-state-cache.ts`, `src/bun/engine/claude/bash-permission-gate.ts`, `src/bun/server/stream-processor.ts` — trimmed-feature backends.
- `src/bun/copilotkit/` — what stays (the new stack).
- `.planning/phases/06-e2e-migration-verification/06-SUMMARY.md` — retire evidence + zero-import proofs (the deletion inventory guide).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Phase 6's retire evidence (grep proofs that the legacy chain has zero importers) — the deletion inventory is pre-verified.
- The 517-test green suite — the post-deletion regression gate.

### Established Patterns
- Phase 6 retire-with-rationale (commit messages document per-file rationale).
- Zero-import verification via grep before deletion.

### Integration Points
- `src/shared/rpc-types.ts` — StreamEvent type removal + trim RPC removal (shared-contract discipline: update rpc-types + handlers + any consumers together).
- `src/bun/server/stream-processor.ts` — the /ws stream pipeline (board events stay; chat streaming removed).
- `src/bun/index.ts` — handler registration removals, importer flag.

</code_context>

<specifics>
## Specific Ideas

- Success criterion 3 is the phase's core: `git grep` zero + suites green after deletion.
- The markClaudeExecution deletion lands here (D-03).
- Legacy import retirement behind flag (D-06).

</specifics>

<deferred>
## Deferred Ideas

- v2 features (regenerate, cancel hardening, thread-list niceties, suggestions, attachments) — v2 milestone.
- Dropping the frozen chat tables entirely — never (rollback safety is a permanent constraint).

</deferred>

---

*Phase: 7-Cleanup & Feature Trim*
*Context gathered: 2026-08-09*
