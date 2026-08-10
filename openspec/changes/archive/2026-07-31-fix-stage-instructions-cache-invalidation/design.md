## Context

**Current mechanism (root cause).** `TransitionExecutor`, `HumanTurnExecutor` (both its normal path and its "Engine session lost" recovery/fallback branch), `RetryExecutor`, and `CodeReviewExecutor` each independently call `SystemPromptAssembler.fromConfig(config, boardId, workflow_state)`, which merges `workflow_instructions` (order 100, board-level, invariant per workflow) with `stage_instructions` (order 200, column-specific — differs on every transition) and custom prompts (order 0–99) into one `systemInstructions` string. This string is passed to `ExecutionParamsBuilder.build()` and ends up in `ExecutionParams.systemInstructions`.

For Pi, `PiSessionManager.getOrCreate()` writes this string into `agent.state.systemPrompt` on the *same persistent session* on every call: `if (systemPrompt !== undefined) existing.agent.state.systemPrompt = systemPrompt;` (`session-manager.ts:61`). The Pi SDK (`@earendil-works/pi-ai`) sends `systemPrompt` as `messages[0]` (`role: "system"`, or `"developer"` for reasoning-capable models) on every single completion call. vLLM/SGLang Automatic Prefix Caching (APC) only reuses the KV cache when the prompt prefix is byte-identical from token 0 — any change to `messages[0]` invalidates the entire cached prefix tree for the conversation, forcing a full re-prefill. This was confirmed as the cause of task 535's execution 5690 hanging indefinitely after streaming 703 chunks under a loaded local vLLM server.

For Claude, `src/bun/ai/anthropic.ts` applies `cache_control: { type: "ephemeral", ttl: "1h" }` to the system block. The direct `AnthropicProvider` (used by `session-memory.ts`/`context.ts` for compaction summaries, not the main execution path) is unaffected by this change — but `ClaudeEngine`/`adapter.ts` (the main execution engine) passes `systemInstructions` through the Claude Code preset's `append`, meaning it suffers the same class of cache-invalidation cost (cost/latency degradation, not a hang) whenever `stage_instructions` changes.

**Existing precedent to reuse.** `DecisionContextInjector.prepare(conversationId)` already solves a structurally identical problem for `<decisions>` blocks: it tracks `conversations.decisions_injected_after_compaction_id` and only re-injects into `userContent` (the tail message, which is inherently fresh per turn) when never-injected or a new compaction has occurred since. `historyBlock` (`CrossEngineContextInjector`) uses the same "append to userContent, never touch systemInstructions" principle for engine-switch history. Both patterns are the template for this fix.

**stage_instructions semantics.** Confirmed via real config (`config/workflows/delivery.yaml`, `openspec-v1.yaml`) that `stage_instructions` are standing behavioral guardrails (e.g. "Don't implement anything!", "exploration mode. Don't change any file!") meant to apply continuously while a task sits in a column — not one-time transition nudges. This rules out "inject once at transition and never again."

## Goals / Non-Goals

**Goals:**
- Make `systemInstructions`/`messages[0]` byte-stable across column transitions and ordinary human turns, for every engine, so vLLM/SGLang APC and Anthropic prompt-caching remain effective.
- Preserve the standing-guardrail semantics of `stage_instructions` (it must still reach the model reliably, including after context is pruned by compaction) without paying per-turn token cost.
- Remove the 5-way duplicated `SystemPromptAssembler` + manual `userContent` join logic across executors (SRP violation) as part of this change, per user decision.
- Fix `RetryExecutor`/`CodeReviewExecutor`, which currently get `stage_instructions` via `systemInstructions` and would otherwise silently lose it once `systemInstructions` is stabilized.
- Change `PiSessionManager`'s session-reuse policy so `systemPrompt` is only recomputed on an actual model/engine change, not on every turn.

**Non-Goals:**
- No change to Claude/Copilot/Cursor engine-specific code — the fix lives entirely in the shared executor/assembler layer; these engines benefit automatically because they consume the same `systemInstructions`/`userContent` fields.
- No new test suite is authored as part of this change (explicitly deferred by the user — "don't focus in testing, this will be tackled later").
- No periodic mid-column refresher for `stage_instructions` beyond transition + post-compaction — if long, uncompacted conversations show real guardrail drift in practice, that is a follow-up.
- No litellm-side mitigation (`stream_idle_timeout`/`ttft_timeout`, PR #30337) — that PR is unmerged upstream and is a different, complementary concern (bounding stalls, not preventing the cache invalidation that causes them).
- `CustomPromptInjector.resolveList()`'s disk-read ordering was investigated and found to be a non-issue (it sorts its final output by `priority` before returning, `custom-prompt-injector.ts:181`) — no change needed there.

## Decisions

### 1. Scope: engine-agnostic fix in the shared executor/assembler layer
Move `stage_instructions` handling out of `SystemPromptAssembler`'s `systemInstructions` output and into a new `userContent`-layer collaborator, used by all 4 primary executors plus `HumanTurnExecutor`'s fallback branch. Rejected: a Pi-only patch, because Claude suffers the same cache-invalidation cost class today (just with a different, less severe symptom — cost/latency instead of a hang) and a Pi-only fix would leave that in place.

### 2. `stage_instructions` moves to `userContent`, ordered last
`userContent = [historyBlock, decisionsBlock, stageInstructionsBlock, resolvedPrompt].filter(Boolean).join("\n\n")`. Placing it immediately before `resolvedPrompt` keeps the standing guardrail closest (in attention/recency terms) to the user's actual request, after conversational context (`historyBlock`) and standing decisions (`decisionsBlock`).

### 3. Re-injection policy: transition + post-compaction (not every turn, not once)
Reuse `DecisionContextInjector`'s exact tracking shape: inject `stageInstructionsBlock` at column-transition time, then only re-inject on the next human turn after a compaction event for that conversation. Rejected alternatives:
- **Every turn**: correct but pays token cost on every ordinary turn and fights a user's own inline override of the stage guidance stated in their own prompt.
- **Once at transition, never again**: cheap, but stage_instructions can be pruned from context by compaction, silently dropping the standing guardrail for the rest of the column's lifetime — the real risk this design must close.
- **Compaction + periodic refresher**: considered but deferred; adds complexity without a demonstrated need (very long uncompacted single-column conversations are not yet observed to actually drift).

### 4. Tracking storage: generalized `conversation_injection_state` table
Rather than adding a second one-off nullable column to `conversations` (mirroring `decisions_injected_after_compaction_id` from migration `042`), introduce a shared `conversation_injection_state` table keyed by `(conversation_id, injection_type)`. Migrate the existing decisions-injection tracking onto this table so both injectors (decisions, stage-instructions) share one schema/mechanism going forward, instead of `conversations` accumulating a new nullable column per injector type. This was chosen over the smaller/cheaper single-column option because the team anticipates more injectors of this shape in the future and prefers paying the migration cost once now.

### 5. Duplication cleanup: single shared prompt-assembly collaborator
Introduce one collaborator responsible for producing both `systemInstructions` (stable: `workflow_instructions` + custom prompts) and the per-turn additions to `userContent` (`stageInstructionsBlock`, via the re-injection policy). All 5 call sites (`TransitionExecutor`, `HumanTurnExecutor` normal + fallback, `RetryExecutor`, `CodeReviewExecutor`) call this single collaborator instead of independently building a `SystemPromptAssembler` and manually joining `userContent`. This also closes a previously-undetected 5th duplicate copy inside `HumanTurnExecutor`'s "Engine session lost" recovery branch. `RetryExecutor`/`CodeReviewExecutor`, which today have no `historyBlock`/`decisionsBlock` concept, gain only the `stageInstructionsBlock` prepend (not history/decisions, which don't apply to their flows) to avoid a stage-instructions regression.

### 6a. Test organization: one shared `ConversationInjectionStateRepository`, not two duplicated injectors
The decisions-injection and stage-instructions-injection re-injection state machines (first-turn/never-injected, already-injected-for-current-compaction, new-compaction-since-last-injection) are structurally identical and are backed by the same `conversation_injection_state` table (decision 4). Rather than implementing and testing this state machine twice under two different class names, generalize it into a single shared `ConversationInjectionStateRepository` that both `DecisionRepository` (via its existing `markDecisionsInjected`/`getLastInjectedCompactionId` method signatures, kept unchanged) and the new stage-instructions injector delegate to. This keeps decision 4's "generalize, don't duplicate" intent consistent at the service layer, not just the schema layer, and means the state-machine logic is tested once. Rejected: fully independent injectors that merely share the same DB table — this would recreate, one layer down, exactly the kind of duplication decision #1631 ("extract shared collaborator now") was meant to eliminate.

### 6b. `PiSessionManager` session-reuse policy: qualified model id equality
`PiSessionManager.getOrCreate()` gains a new `qualifiedModelId: string` parameter (the same value the caller, `PiEngine.execute()`, already has locally as `modelOverride` before calling `modelBuilder.build()`). `sessions` changes from `Map<number, AgentSession>` to `Map<number, { session: AgentSession; qualifiedModelId: string }>`. On reuse, `systemPrompt` is only recomputed/overwritten when the incoming qualified id differs from the stored one; pure column transitions (same model) never touch it. Rejected: comparing resolved `Model<"openai-completions">` object fields (`provider`, `id`) — riskier, since `Model` objects also carry `contextWindow`/`maxTokens`/sampling-adjacent fields that could differ without representing a "real" model change; the qualified id string is already the single source of truth used elsewhere in the codebase (`QualifiedModelId`, `resolveModel()`). Rejected: a DB read from `conversations.model` inside `PiSessionManager` — would add a new DB dependency to a class that currently has none, and a DB round-trip on every turn, when the caller already has the value in hand.

### 7. stage_instructions gets an explicit, authoritative `<active_directive>` framing
Follow-up refinement after the initial fix shipped: `stageInstructionsBlock` was previously unframed raw text (unlike `historyBlock`'s `<message_history>` XML tag or `decisionsBlock`'s markdown header). This under-signals that the content is a binding, standing rule the model must keep following — not a one-time nudge or optional context. `StageInstructionsInjector` now wraps the column's `stage_instructions` text in a fixed template:

```
<active_directive>
(stage instruction from the column)

This directive is currently in force. Follow it in every response until it is
replaced by a new active_directive or the user explicitly asks you to override it.
</active_directive>
```

The tag name `active_directive` was deliberately chosen over reusing `systemInstructions` (name-collides with the real `ExecutionParams.systemInstructions`/`messages[0]` field, and overclaims which channel the content is on — it's still a `userContent` tail message, not the system role) and over a "column"-based name (models have no notion of workflow columns as a concept; the tag must be self-explanatory without that context). The trailing sentence is a fixed, invariant string appended after the actual instruction text — not reworded per column.

### 8. Explicit cancellation when a column defines no stage_instructions
The `active_directive` wording makes an explicit promise ("...until replaced..."). Silence (the original design's `stageInstructionsBlock: undefined` when a column has no `stage_instructions`) breaks that promise: a prior column's directive could keep being obeyed by the model even after transitioning into a column where it no longer applies (e.g. "Don't implement anything" from a `plan` column bleeding into a `build` column with no `stage_instructions`, where implementation is now the actual task). `StageInstructionsInjector` therefore never returns a silent `undefined`-turned-nothing outcome at an injection-due point (transition or first turn after compaction) — when the column has no `stage_instructions`, it returns an explicit cancellation block instead:

```
<active_directive>
None. Any previously active directive is no longer in force. Follow only the
user's current instructions and general guidance until a new active_directive
is issued.
</active_directive>
```

This is sent unconditionally at every injection-due point for a no-`stage_instructions` column (not only when the immediately preceding column actually had one) — simpler and safer than tracking "was there a previously-active directive for this conversation" as new state, at the cost of occasionally sending a small, fixed cancellation string where nothing needed cancelling. Symmetric with the real-directive case: it is resent on every subsequent injection-due point (transition into another no-instructions column, or the first turn after each compaction) rather than only once, since compaction summaries risk resurfacing stale directive text from deep history and the model should always get a fresh, current answer to "what directive applies right now."

Both the real directive and the cancellation route through the same `PromptAssemblyService`/re-injection-due check used by all 5 executor call sites (`TransitionExecutor`, `HumanTurnExecutor` normal + fallback, `RetryExecutor`, `CodeReviewExecutor`) — none of them special-case "no stage_instructions" as silence anymore.

## Risks / Trade-offs

- **[Risk] Guardrail drift in very long, uncompacted single-column conversations** — if a task sits in one column for many turns without ever triggering a compaction, `stage_instructions` is only in context from the original transition-time injection, which could scroll out of the model's effective attention window over a very long conversation. → **Mitigation**: not addressed in this change (accepted trade-off per decision on re-injection policy); can add a periodic refresher later if real drift is observed in practice.
- **[Risk] Migrating `decisions_injected_after_compaction_id` onto the new generalized table is a larger, riskier change than a single new column** — touches `DecisionRepository`, a working, tested feature. → **Mitigation**: keep the migration data-preserving (copy existing column values into the new table under `injection_type = 'decisions'` as part of the same migration), and keep `DecisionRepository`'s public method signatures (`markDecisionsInjected`, `getLastInjectedCompactionId`) unchanged so `DecisionContextInjector` and its callers require no changes beyond the repository's internal storage.
- **[Risk] `HumanTurnExecutor`'s recovery/fallback branch is a less-common, error-handling code path** — folding it into the shared collaborator changes behavior on a path that's harder to exercise in normal testing. → **Mitigation**: the change is purely mechanical (same collaborator, same inputs available on that branch — `effectiveModel`, `column`, `workingDirectory` are already computed there); no new branching logic is introduced.
- **[Risk] `RetryExecutor`/`CodeReviewExecutor` gaining `stageInstructionsBlock` changes their prompt shape** — these executors currently pass a raw prompt string; adding a prepended block changes what the model receives on retry/review turns. → **Mitigation**: this restores parity with today's behavior (both already include `stage_instructions` via `systemInstructions`), so the net guardrail behavior for the model is unchanged — only its location in the request shifts from system to user content.
- **[Trade-off] `PiSessionManager.sessions` value-type change is a breaking internal API change** — `get()`, `dispose()`, `disposeAll()`, and existing tests (`pi-engine.test.ts`, `pi/session-manager.test.ts`) that assume a bare `AgentSession` value need updates. → Accepted; confined to `PiSessionManager` and its direct test callers, not a public/RPC-facing change.

## Migration Plan

1. Add a new DB migration creating `conversation_injection_state (conversation_id INTEGER, injection_type TEXT, last_injected_after_compaction_id INTEGER, PRIMARY KEY (conversation_id, injection_type))`, and backfill it from existing `conversations.decisions_injected_after_compaction_id` rows (`injection_type = 'decisions'`) where non-null.
2. Update `DecisionRepository.markDecisionsInjected`/`getLastInjectedCompactionId` to read/write the new table instead of the `conversations` column, keeping their public signatures unchanged.
3. Introduce the new shared prompt-assembly collaborator (final class shape/name to be settled during implementation) that produces stable `systemInstructions` (workflow_instructions + custom prompts only) and the compaction-tracked `stageInstructionsBlock`, backed by the same generalized table under `injection_type = 'stage_instructions'`.
4. Update all 5 call sites to use the new collaborator and the new `userContent` ordering.
5. Update `PiSessionManager` to accept `qualifiedModelId`, change its internal map shape, and gate `systemPrompt` overwrites on qualified-id changes; update `PiEngine.execute()` call sites to pass the qualified id.
6. No rollback complexity beyond standard migration `down()` no-ops (SQLite lacks `DROP COLUMN` pre-3.35, consistent with existing migrations in this codebase) — the old `conversations.decisions_injected_after_compaction_id` column is left in place (unused) rather than dropped, for safety.

## Testing Strategy

All testing follows existing conventions in `src/bun/test/` — no new test infrastructure or testability-motivated refactors are required; the codebase's existing DI shape (constructor-injected engines/builders/injectors, `initDb()` in-memory SQLite, `CapturingParamsBuilder`/`StubStreamProcessor`/`TestEngine` from `executor-test-helpers.ts`) already supports every scenario below. No Playwright/e2e coverage is added: this change has no RPC/API surface impact, and no existing `e2e/` test references `stage_instructions`/`systemInstructions`/`SystemPromptAssembler`.

**Unit tests (no DB):**
- Shared prompt-assembly collaborator — mirrors `system-prompt-assembler.test.ts`'s mocked-injector pattern. Asserts `systemInstructions` output never contains `stage_instructions` content, and that `workflow_instructions`/custom-prompt ordering/precedence is preserved from today's behavior.
- `PiSessionManager` — extends `pi/session-manager.test.ts`'s `FakeAgentSession` + factory DI pattern with new cases: same qualified model id on reuse → `systemPrompt` untouched even when a new value is passed; different qualified model id → `systemPrompt` overwritten and the stored id updated.

**Integration tests (in-memory DB via `initDb()`):**
- `ConversationInjectionStateRepository` — one shared test suite covering the re-injection state machine (first-turn/never-injected, already-injected-for-current-compaction, new-compaction-since-last-injection, sentinel-value handling), exercised across both `injection_type` values rather than duplicated per injector (per decision 6a).
- `DecisionRepository` — existing `DR-9`/`DR-10`/`DR-10b` tests retained, now asserting through the delegating methods against the new shared table.
- New stage-instructions injector — mirrors `decision-context-injector.test.ts`'s `DCI-1`..`DCI-7` structure (undefined-on-first-turn-no-content, block-returned-when-content-exists, suppressed-on-second-call, re-injected-after-compaction, sentinel-blocks-re-injection, block-format assertions).
- All 5 executor call sites (`TransitionExecutor`, `HumanTurnExecutor` normal + fallback, `RetryExecutor`, `CodeReviewExecutor`) — extended with `userContent`-ordering assertions (`[historyBlock, decisionsBlock, stageInstructionsBlock, resolvedPrompt]`) and `stageInstructionsBlock` presence/absence per the re-injection policy. `RetryExecutor`/`CodeReviewExecutor` gain new assertions confirming they still receive stage guardrails (now via prompt prepend, not `systemInstructions`).
- `transition-executor.test.ts`'s `TP-1`/`TP-2` placeholder tests (`expect(true).toBe(true)`) replaced with real assertions.
- New coverage for `HumanTurnExecutor`'s "Engine session lost" fallback branch verifying it receives the same decisions/stage-instructions treatment as the normal path (using `TestEngine(true)`, the existing trigger mechanism from `HT-3`/`HT-GC-2`) — currently has zero prompt-assembly verification.
- A dedicated regression test asserting `systemInstructions` is byte-identical across two column transitions on the same conversation/model with differing `stage_instructions` configured per column — the direct encoding of the bug this change fixes.
- A migration test extending `db-migrations.test.ts`'s seed-then-migrate pattern: seed a pre-migration DB with populated `conversations.decisions_injected_after_compaction_id` values, run the migration, assert correct backfill into `conversation_injection_state`.

## Open Questions

- Final concrete name/shape for the shared prompt-assembly collaborator (e.g. evolved `SystemPromptAssembler` vs. a new `PromptAssemblyService`, and whether stage-instructions tracking lives in a new sibling `StageInstructionsInjector` class or is folded into an extended `DecisionContextInjector`-like base) — left to implementation-time judgment within the constraints above.
- Whether `conversation_injection_state.last_injected_after_compaction_id` should also store an explicit `injected_at` timestamp for observability/debugging — not required for correctness, can be added trivially during implementation if useful.
