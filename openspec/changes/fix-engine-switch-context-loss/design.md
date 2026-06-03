## Context

`CrossEngineContextInjector` in `src/bun/conversation/cross-engine-context.ts` is the central class responsible for detecting engine switches and injecting DB-backed message history into the new engine's context. It is constructed in `orchestrator.ts` (currently three times, once per executor) and called by `ChatExecutor`, `HumanTurnExecutor`, and `TransitionExecutor`.

Two layered bugs cause context to be silently lost when switching back to a previously-used engine:

1. **Anchor exclusion bug** (`cross-engine-context.ts`): `fetchMessagesSinceAnchor` uses `id > anchor.id` — the `compaction_summary` row is the anchor AND the most valuable context row, but it's excluded from the result set. `formatHistoryBlock` already renders `compaction_summary` as `<SUMMARY>` — it just never receives one.

2. **Wrong source-engine bug** (`human-turn-executor.ts`, `transition-executor.ts`): `sourceEngine` is resolved from `conversation_model` (already the target model) rather than `last_engine_type` (the actual previous engine). Under large-conversation switches, this causes `piEngine.compact()` to run on an empty Pi session, writing a spurious `compaction_summary` that becomes the new anchor — effectively resetting the history window before injection.

A third minor issue: `appendMessage` is called before `prepareSwitch` in both `chat-executor` and `human-turn-executor`, so the current user message appears in both the `<message_history>` block and the main prompt.

## Goals / Non-Goals

**Goals:**
- Fix compaction_summary inclusion in fetched history (anchor inclusive, `>=`)
- Move source-engine resolution into `CrossEngineContextInjector` to eliminate the wrong-engine bug at all call sites
- Exclude the in-flight user message from the injected history block
- Consolidate three stateless `CrossEngineContextInjector` instances to one
- Add regression tests for the three fixed scenarios

**Non-Goals:**
- Changing how the Claude SDK resumes native sessions (native session + injected history duplication is a separate concern)
- Fixing the retry/fallback path in `human-turn-executor` (lines 72–139) — it doesn't invoke `prepareSwitch` at all
- Any changes to the Pi background compaction mechanism
- Frontend or API changes

## Decisions

### Decision: Source-engine resolution moves inside `CrossEngineContextInjector`

**Chosen**: Inject `EngineRegistry` into `CrossEngineContextInjector`'s constructor; resolve the source engine from `last_engine_type` internally; remove `sourceEngine` from `prepareSwitch` signature.

**Alternatives considered**:
- *Fix at each call site* — would require every caller to do the DB read and pass the correct engine. Works, but each new executor added in the future could repeat the mistake.
- *Pass `last_engine_type` string directly* — intermediate; avoids the registry injection but still exposes resolution responsibility to callers.

**Rationale**: The injector already reads `last_engine_type` from the DB to decide whether injection is needed. Resolving the source engine from that same value is a natural extension of its responsibility. It also makes the class self-contained: callers only need to provide `conversationId`, `targetEngineId`, `targetModelInfo`, `workingDirectory`, and `workspaceKey`.

### Decision: Anchor query changes from `id > anchor` to `id >= anchor`

**Chosen**: `WHERE conversation_id = ? AND id >= ? ORDER BY id ASC LIMIT 200`

**Rationale**: The compaction_summary row is both the anchor and a content row (the Pi summary). Using strict greater-than means this summary is always excluded. The `formatHistoryBlock` filter already handles `compaction_summary` type; the fix is a single character change in the query with no other impact.

### Decision: Exclude in-flight user message via `excludeBeforeMsgId`

**Chosen**: Add optional `excludeBeforeMsgId?: number` to `prepareSwitch`; when provided, add `AND id < excludeBeforeMsgId` to `fetchMessagesSinceAnchor`.

**Alternatives considered**:
- *Call `appendMessage` after `prepareSwitch`* — would require returning `msgId` from `prepareSwitch` or restructuring the executor flow significantly.
- *Filter the message in `formatHistoryBlock`* — less clean, the message ID isn't available there.

**Rationale**: Passing the just-stored message ID as an upper-bound exclusion is a minimal, surgical change to the query. The executor already has `msgId` before calling `prepareSwitch`.

## Risks / Trade-offs

- **`CrossEngineContextInjector` now depends on `EngineRegistry`** — increases coupling slightly. Mitigated by the fact that this dependency is already present in all three executor constructors; the injector is the right owner.

- **`>=` anchor change may return the compaction_summary on every call when one exists** — this is correct and expected behavior. `formatHistoryBlock` renders it as `<SUMMARY>`, providing more complete context. No known downside.

- **`LIMIT 200` on `fetchMessagesSinceAnchor` unchanged** — if >200 messages exist after the last compaction, only 200 are returned. This was pre-existing behavior and is out of scope for this fix.

## Migration Plan

No DB schema changes. No API changes. The changes are entirely internal to the backend engine execution layer. Existing test suite runs green; three new tests are added. No rollback strategy needed beyond reverting the commit.

## Open Questions

*(none)*
