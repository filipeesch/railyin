## Context

Decision records are a first-class concept in the system: the AI uses `decision_request` to surface architectural choices, users answer them, and the answers are persisted and re-injected into AI context so decisions survive context compaction. Two problems exist today:

1. **Thin auto-save** — the frontend auto-saves `{question, answer: optionTitle}` pairs on submit, throwing away the AI's rich option descriptions. The AI never writes a contextualized record.
2. **System-prompt injection** — `ExecutionParamsBuilder` appends decisions to `systemInstructions`, which invalidates the provider's cached system prompt on every decision change. For Claude and Copilot this means a full prompt-cache miss on every new decision.

The fix: make the AI the sole author of decision records (using the existing `record_decision` tool), and move injection to the user-message layer (mirroring the `CrossEngineContextInjector` / `<message_history>` pattern already used on engine switch).

## Goals / Non-Goals

**Goals:**
- AI-authored, richly contextualized decision records — the AI calls `record_decision` with full prose after receiving answers
- System prompt cache stability — decisions never touch `systemInstructions`
- One-time injection per compaction cycle — `<decisions>` block prepended to user prompt once after each compaction, and on the very first turn (sentinel 0), so context is always current without per-turn noise
- Dedicated `submitDecisions` RPC for both tasks and chat sessions — clean separation from `sendMessage`; hidden server-side instruction enforces `record_decision` call
- General notes field on every decision form — optional free-form textarea for overarching context beyond per-question notes

**Non-Goals:**
- Changes to `DecisionRecord` read/display paths (`decisions.list`, `DecisionsPanel`) — out of scope
- Changing the `record_decision` or `update_decision` tool contracts — description update only
- Adding retry or conflict-resolution logic for AI record-writing failures

## Decisions

### D1: AI is sole author of decision records via `record_decision`
**Why**: The AI has full context on all options and their descriptions. A human-selected option title is ambiguous ("Option B") whereas the AI can write "chose DI pattern over global registry because the codebase already uses constructor injection in all services". The `record_decision` tool already exists; we just need to enforce its use.

**How enforced**: `record_decision` tool description gains ALWAYS/NEVER language. The `buildDecisionSubmission()` helper appends a hidden plain-text instruction to `engineContent` (not `content`) that the AI receives alongside the user's answers.

**Alternative considered**: Keep auto-save as a fallback. Rejected — a thin auto-save alongside AI authorship creates duplicate/conflicting records with no clear precedence.

### D2: `<decisions>` block injected into user prompt, not system instructions
**Pattern**: Mirrors `CrossEngineContextInjector.prepareSwitch()` exactly. The new `DecisionContextInjector.prepare(conversationId)` returns `{ decisionsBlock: string | undefined }`. Both `HumanTurnExecutor` and `TransitionExecutor` call it alongside the existing cross-engine injector and prepend the block: `[historyBlock, decisionsBlock, resolvedPrompt].filter(Boolean).join('\n\n')`.

**Why user prompt, not system**: System prompt changes invalidate the provider's cache. The user-message layer has no caching implications and is already the injection point for `<message_history>`.

**Alternative considered**: Append to system instructions on a low-frequency timer to reduce cache misses. Rejected — cache invalidation is still unpredictable and the architecture is more complex.

### D3: One-time injection per compaction, tracked by DB column
**Tracking**: `conversations.decisions_injected_after_compaction_id INTEGER NULL`.
- `NULL` = never injected
- `0` = injected before first compaction (sentinel for "first turn")
- `N` = injected after the compaction_summary message with id N

**Trigger**: `DecisionContextInjector.prepare()` queries the last `compaction_summary` message id for the conversation. If it differs from `decisions_injected_after_compaction_id` (or is NULL), it returns the block and calls `markDecisionsInjected()`. Otherwise returns `undefined`.

**First turn**: On the very first turn (no compaction_summary exists), inject once and write sentinel `0`.

**Why not inject on every turn**: The SDK maintains its own session — re-injecting every turn would duplicate the block in the model's view of the conversation history.

### D4: Dedicated `submitDecisions` RPC (not overloaded `sendMessage`)
**New methods**: `tasks.submitDecisions({ taskId, answers })` and `chatSessions.submitDecisions({ sessionId, answers })`. Both use shared `buildDecisionSubmission(answers)` from `src/bun/conversation/decision-submission.ts`.

`buildDecisionSubmission` returns:
- `userContent`: formatted Q&A text (visible, persisted)
- `engineContent`: `userContent` + hidden instruction directing the AI to, for each answer: (1) call `list_decisions()` to check if a record already exists for that question, (2) if found call `update_decision(id, newAnswer, reason)`, (3) if not found call `record_decision(question, answer, weight, notes?)`. NEVER create a duplicate by calling `record_decision` when a record already exists.

**Why dedicated method**: Keeps `sendMessage` clean — no dual-mode logic. The hidden instruction lives server-side (no frontend rebuild needed to change it). The contract is explicit about intent.

**`decisionBatch` removal**: `sendMessage` params lose `decisionBatch` entirely. `DecisionInput` type can be removed or repurposed.

### D5: `buildContextBlock` replaces `buildSystemBlock`
`DecisionRepository.buildContextBlock(conversationId)` returns a `<decisions>` XML block (matching the `<message_history>` pattern) instead of a markdown `## Decision Records` block. Format:

```xml
<decisions>
[CRITICAL] question → answer [AI-recorded]
[MEDIUM] question → answer (revised 1x · reason)
</decisions>
```

`buildSystemBlock` is removed and `ExecutionParamsBuilder` no longer calls any decision repo method.

## Risks / Trade-offs

- **[Risk] AI fails to call `record_decision`/`update_decision`** → Mitigation: The hidden instruction in `engineContent` is authoritative; the ALWAYS/NEVER tool description reinforces it. The instruction requires checking `list_decisions()` first and using `update_decision` for existing records to avoid duplicates. No auto-save fallback — accepted risk; if AI skips the call, no record is written (visible gap in the Decisions tab is a forcing function).
- **[Risk] First-turn injection on chat sessions with no prior compaction** → Sentinel 0 handles this; the block is injected once and subsequent turns skip it until the next compaction.
- **[Risk] DB migration on existing conversations** → `NULL` default on new column means all existing conversations are treated as "never injected" and will get the block on their next turn. This is correct behavior.
- **[Risk] `decisionBatch` removal is a **BREAKING** change for any client calling `sendMessage` with `decisionBatch`** → Only the frontend (`MessageBubble.vue`) calls this path; it is updated in the same change.

## Migration Plan

1. Migration `042` adds `decisions_injected_after_compaction_id INTEGER NULL` to `conversations` — non-destructive, safe rollout.
2. Remove `decisionBatch` from `sendMessage` handler — any existing in-flight requests with `decisionBatch` will have it silently ignored until the handler is updated (no crash, data just not persisted; acceptable given this is a same-PR change).
3. No data backfill needed — existing `decision_records` with `is_source_ai = 0` remain valid and will appear in the `<decisions>` block.
