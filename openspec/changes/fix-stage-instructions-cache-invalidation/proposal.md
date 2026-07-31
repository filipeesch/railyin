## Why

Column transitions inject `stage_instructions` into `systemInstructions` (`messages[0]`, the system role), which is mutated in place on the persistent Pi session on every transition and human turn. vLLM/SGLang Automatic Prefix Caching only reuses the KV cache when the prompt prefix is byte-identical from token 0, so any column transition invalidates the entire cached prefix, forcing a full re-prefill under load. This was confirmed as the root cause of task 535's execution 5690, which streamed 703 chunks then hung indefinitely with no `done`/error event. The same mechanism also silently degrades Anthropic's `cache_control` prompt-caching economics on every column transition for Claude conversations (cost/latency, not a hang). This must be fixed now because the hang is a severe, user-visible reliability issue, and the fix is cheap relative to the risk of leaving cache-busting behavior in the shared execution path.

## What Changes

- Move `stage_instructions` out of `systemInstructions`/`messages[0]` and into `userContent` (the always-fresh tail message), ordered last, immediately before the resolved prompt: `[historyBlock, decisionsBlock, stageInstructionsBlock, resolvedPrompt]`.
- `systemInstructions` becomes stable for the life of a session: only `workflow_instructions` (board-level, invariant per workflow) and custom prompts remain in it. Column-specific `stage_instructions` never appears there again.
- Introduce a re-injection policy for `stageInstructionsBlock`, mirroring `DecisionContextInjector`'s existing pattern: inject once at column transition, then only re-inject on the next human turn after a compaction event for that conversation (not on every ordinary turn, avoiding unnecessary token cost and avoiding fighting a user's own inline override).
- Generalize the per-conversation "last injected after compaction" tracking into a shared `conversation_injection_state` table keyed by `(conversation_id, injection_type)`, migrating the existing `decisions_injected_after_compaction_id` column onto the same mechanism so both decisions and stage-instructions injectors share one schema.
- Extract a single shared prompt-assembly collaborator that all 5 call sites use instead of each independently building a `SystemPromptAssembler` + joining `userContent`: `TransitionExecutor`, `HumanTurnExecutor` (both the normal path and the "Engine session lost" recovery/fallback branch), `RetryExecutor`, and `CodeReviewExecutor`. This removes the duplicated inline assembly logic (SRP) and ensures `RetryExecutor`/`CodeReviewExecutor` gain correct stage-instructions coverage they previously got via `systemInstructions` (avoiding a behavior regression where retries/code-review would otherwise silently lose standing column guardrails like "Don't implement anything!").
- `PiSessionManager.getOrCreate()` changes its session-reuse policy: `agent.state.systemPrompt` is only recomputed/overwritten when the incoming qualified model id differs from what the existing session was built with. Pure column transitions (same model) never touch it. `PiSessionManager.sessions` changes from `Map<number, AgentSession>` to `Map<number, { session: AgentSession; qualifiedModelId: string }>` to track this in memory (no new DB dependency).
- No Claude-specific code changes are required: `ClaudeEngine`/`adapter.ts` consumes the same `systemInstructions` field via the Claude Code preset's `append`, so stabilizing `systemInstructions` at the shared executor/assembler layer automatically fixes Claude's cache-invalidation cost too.
- **Refinement**: `stageInstructionsBlock` is now wrapped in a fixed, authoritative `<active_directive>` template (real instruction + invariant "follow until replaced/overridden" sentence) instead of being delivered as raw unframed text. When a column defines no `stage_instructions`, an explicit fixed cancellation `<active_directive>None. Any previously active directive is no longer in force...</active_directive>` is sent at every injection-due point instead of silently omitting the block — closing the gap where a prior column's directive could otherwise appear to linger indefinitely given the new "follow until replaced" wording. This applies uniformly across all 5 executor call sites via the shared `PromptAssemblyService`.

## Capabilities

### New Capabilities
- `stage-instructions-injection`: Defines the shared prompt-assembly collaborator, the `stageInstructionsBlock` re-injection policy (transition + post-compaction), and the generalized `conversation_injection_state` tracking table used by both stage-instructions and decision injection.

### Modified Capabilities
- `workflow-instructions`: `stage_instructions` is no longer concatenated into `systemInstructions` alongside `workflow_instructions`. Only `workflow_instructions` (and custom prompts) remain in the system-level content; `stage_instructions` moves to the `userContent` layer.
- `pi-engine`: The Session lifecycle requirement's system-prompt reuse behavior changes — `PiSessionManager.getOrCreate()` only overwrites `agent.state.systemPrompt` on an existing session when the qualified model id changes, not whenever a non-undefined `systemPrompt` is passed.
- `decision-context-injector`: The per-conversation "injected after compaction" tracking moves from the dedicated `conversations.decisions_injected_after_compaction_id` column to a generalized `conversation_injection_state` table shared with the new stage-instructions injector. The documented `userContent` assembly order for `HumanTurnExecutor`/`TransitionExecutor` gains a `stageInstructionsBlock` slot between `decisionsBlock` and `resolvedPrompt`.

## Impact

- **Code**: `src/bun/engine/execution/system-prompt-assembler.ts`, `transition-executor.ts`, `human-turn-executor.ts`, `retry-executor.ts`, `code-review-executor.ts`, `src/bun/engine/pi/session-manager.ts`, `src/bun/conversation/decision-context-injector.ts`, `src/bun/db/repositories/decision-repository.ts`.
- **Database**: new migration adding `conversation_injection_state` table; migrates existing `decisions_injected_after_compaction_id` data into it.
- **Engines affected**: Pi (fixes the hang via prefix-cache stability), Claude (fixes cache-economics degradation, no code change needed), Copilot/Cursor (systemInstructions stabilization is neutral/beneficial, no behavior-breaking change expected).
- **No breaking API/RPC changes** — this is an internal execution-pipeline fix; `ExecutionParams`'s `systemInstructions`/`prompt` fields keep their existing shape and meaning.

## Test Scope

Testing is scoped entirely to existing unit/integration conventions in `src/bun/test/` (no Playwright/e2e coverage needed — confirmed no `e2e/` test references `stage_instructions`/`systemInstructions`/`SystemPromptAssembler`, and this is a backend-internal change with no RPC/API contract impact). No new testability refactors are required — the codebase's existing DI shape (constructor-injected engines/builders/injectors, `initDb()` in-memory SQLite, `CapturingParamsBuilder`/`StubStreamProcessor`/`TestEngine` helpers) already supports every scenario below.

- **Unit tests (no DB)**: shared prompt-assembly collaborator (mirroring `system-prompt-assembler.test.ts`'s mocked-injector pattern) — asserts `systemInstructions` never contains stage content and custom-prompt/workflow-instruction ordering is preserved. `PiSessionManager` (extending `pi/session-manager.test.ts`'s `FakeAgentSession`/factory DI pattern) — asserts qualified-model-id equality gates `systemPrompt` overwrite on reuse.
- **Integration tests (in-memory DB via `initDb()`)**:
  - A single shared `ConversationInjectionStateRepository` state-machine test suite (first-turn/never-injected, already-injected-for-current-compaction, new-compaction-since-last-injection, sentinel handling), reused by both `injection_type = 'decisions'` and `injection_type = 'stage_instructions'` rather than duplicated per injector.
  - `DecisionRepository`'s existing DR-9/DR-10/DR-10b tests, now asserting through its delegating methods against the new shared table.
  - A new stage-instructions injector test suite mirroring `decision-context-injector.test.ts`'s DCI-1..7 structure.
  - Extended executor test suites for all 5 call sites (`TransitionExecutor`, `HumanTurnExecutor` normal + fallback, `RetryExecutor`, `CodeReviewExecutor`) covering `userContent` ordering and `stageInstructionsBlock` presence/absence.
  - Replacement of `transition-executor.test.ts`'s `TP-1`/`TP-2` placeholder assertions with real ones.
  - New coverage for `HumanTurnExecutor`'s "Engine session lost" fallback branch (using `TestEngine(true)`, as `HT-3`/`HT-GC-2` already do), which currently has zero prompt-assembly verification.
  - A dedicated regression test asserting `systemInstructions` byte-identity across two column transitions on the same conversation/model with differing `stage_instructions` — the direct encoding of the bug this change fixes.
  - A migration test (extending `db-migrations.test.ts`'s seed-then-migrate pattern) asserting `conversation_injection_state` is correctly backfilled from pre-existing `decisions_injected_after_compaction_id` values.
