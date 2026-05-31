## Context

`ChatExecutor` handles chat session executions (standalone AI chat, not task-linked). It shares the same multi-engine registry as the task executor path but was never wired to the `CrossEngineContextInjector` that task executors (`TransitionExecutor`, `HumanTurnExecutor`) use to bridge conversation history across engine boundaries.

Each engine stores its native conversation history independently:
- **Claude**: `~/.claude/projects/{hash}/sessions/{session_id}.jsonl`
- **Copilot**: SDK-managed session keyed by conversationId
- **Pi**: `~/.railyin/pi-sessions/{sha1(conversationId)}.jsonl`

When the user switches engine mid-conversation, the new engine starts from an empty session. The `CrossEngineContextInjector` already solves this by reading DB-persisted messages and formatting them as a `<message_history>` XML block prepended to the user prompt. The fix is purely a wiring gap — the class exists and works; `ChatExecutor` just doesn't call it.

Additionally, `conversations.last_engine_type` is never updated for chat turns, so even if the injector was called, switch detection would always yield `null` (no injection). Both the call and the write must be added together.

## Goals / Non-Goals

**Goals:**
- Chat sessions preserve full conversational context when the user switches engine
- `ChatExecutor` maintains `conversations.last_engine_type` after each turn, identical to task executors
- Pre-switch compaction is triggered when a Pi-engine chat session is large and the user switches to a smaller-context engine
- The model-update condition in `ChatExecutor` is corrected to always sync when the model changes

**Non-Goals:**
- No changes to task executor paths — they already work correctly
- No new DB migrations — `last_engine_type` column already exists (migration 041)
- No frontend changes — the fix is entirely backend
- No changes to the `CrossEngineContextInjector` class itself — it is correct as-is

## Decisions

### Decision: Inject history block into `engineContent` only (not `content`)

The `engineContent` is the internal prompt sent to the AI; `content` is the user-facing message stored in `conversation_messages`. The history block belongs in the engine prompt, not in what the user sees.

**Rationale**: Consistent with how task executors handle this (`userContent = [historyBlock, ...].join("\n\n")` becomes `prompt`, while only raw `content` is stored in DB). Mixing history context into the visible message would pollute the chat log.

### Decision: Derive `sourceEngine` from `conversations.last_engine_type`

By the time `ChatExecutor` runs, `conversations.model` may already reflect the **new** model (written by `chatSessions.setModel` before the turn). Deriving source from `model` would be incorrect. Instead, read `last_engine_type` from the DB and resolve via `engineRegistry.getEngineById()`.

**Alternatives considered**: Always pass `null` (skip compaction). Rejected because large Pi chat sessions switching to a small-context model could produce oversized history blocks.

### Decision: Write `last_engine_type` immediately after `runNonNative()`

Identical to `TransitionExecutor` and `HumanTurnExecutor`. The execution is committed at this point — the user message is in DB, the execution row is created. Deferring to stream completion would require a new callback chain through `StreamProcessor` for marginal correctness gain.

### Decision: `ChatExecutor` receives `CrossEngineContextInjector` via constructor injection

Consistent with DI pattern used across all executors. Each executor receives its own `CrossEngineContextInjector(db)` instance constructed in `Orchestrator` — the class is stateless so separate instances are functionally equivalent. This mirrors the existing pattern for `TransitionExecutor` and `HumanTurnExecutor`.

## Risks / Trade-offs

**[Risk] `listModels()` called on target engine even for same-engine turns** → `prepareSwitch()` returns early on same-engine turns (before formatting messages), but `listModels()` still runs for `targetModelInfo` resolution. For Copilot, this is a network call. **Mitigation**: This is identical to the existing behavior in task executors — acceptable. Future optimization could cache model lists, but that's out of scope here.

**[Risk] Source engine resolved but not used when engines match** → `getEngineById(lastEngineType)` is called every turn even when no switch occurs. The lookup is a Map lookup (O(1)) — negligible overhead.

**[Risk] `last_engine_type` written for the failed Pi pre-flight check path** → `ChatExecutor` has an early-exit path for Pi sessions without a configured context window. `last_engine_type` should not be written for this case since no execution runs. **Mitigation**: Write `last_engine_type` only after `runNonNative()` is called (i.e., after the Pi pre-flight check passes).

## Migration Plan

No migration needed. The `last_engine_type` column defaults to `null` for existing chat conversations. On the first turn after deployment, `prepareSwitch()` will see `null` and return no history block (correct — no prior engine to bridge from). Subsequent turns will track and inject correctly.

## Open Questions

None — all design decisions are resolved.
