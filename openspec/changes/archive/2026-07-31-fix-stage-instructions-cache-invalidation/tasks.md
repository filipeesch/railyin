## 1. Database migration: shared injection-state table

- [x] 1.1 Add migration creating `conversation_injection_state (conversation_id INTEGER, injection_type TEXT, last_injected_after_compaction_id INTEGER, PRIMARY KEY (conversation_id, injection_type))`, following the existing guard/no-op-down pattern from `041_last_engine_type.ts`/`042_decisions_injection_tracking.ts`.
- [x] 1.2 In the same migration, backfill rows from existing `conversations.decisions_injected_after_compaction_id` (non-null values) into `conversation_injection_state` with `injection_type = 'decisions'`.
- [x] 1.3 Add/update row types in `src/bun/db/row-types.ts` for the new table.
- [x] 1.4 Create a shared `ConversationInjectionStateRepository` exposing `getLastInjected(conversationId, injectionType)` / `markInjected(conversationId, injectionType, compactionSummaryId)`, implementing the re-injection state machine exactly once.
- [x] 1.5 Add a migration test (extending `db-migrations.test.ts`'s seed-then-migrate pattern) that seeds a pre-migration DB with populated `conversations.decisions_injected_after_compaction_id` values and asserts correct backfill into `conversation_injection_state`.

## 2. Update DecisionRepository to use the shared table

- [x] 2.1 Update `DecisionRepository.markDecisionsInjected` / `getLastInjectedCompactionId` to delegate to `ConversationInjectionStateRepository` (`injection_type = 'decisions'`) instead of reading/writing `conversations.decisions_injected_after_compaction_id` directly, keeping method signatures unchanged.
- [x] 2.2 Update/verify existing decision-context-injector tests (DCI-1..7) and decision-repository tests (DR-9/DR-10/DR-10b) still pass against the new storage.
- [x] 2.3 Add a shared `ConversationInjectionStateRepository` test suite covering the re-injection state machine (first-turn/never-injected, already-injected-for-current-compaction, new-compaction-since-last-injection, sentinel handling) exercised across both `injection_type` values, rather than duplicated per injector.

## 3. Shared prompt-assembly collaborator

- [x] 3.1 Design and implement the shared collaborator (e.g. extend `SystemPromptAssembler` or introduce a new `PromptAssemblyService`) that: (a) produces stable `systemInstructions` from `workflow_instructions` + custom prompts only (no `stage_instructions`), and (b) produces a `stageInstructionsBlock` for `userContent` per the transition+post-compaction re-injection policy, backed by `ConversationInjectionStateRepository` with `injection_type = 'stage_instructions'`.
- [x] 3.2 Ensure the collaborator's re-injection check mirrors `DecisionContextInjector.prepare()`'s logic shape (first-turn/never-injected, already-injected-for-current-compaction, new-compaction-since-last-injection cases).
- [x] 3.3 Ensure `stage_instructions` absent for a column yields `stageInstructionsBlock: undefined` without touching tracking state (mirroring `DecisionContextInjector`'s empty-block behavior).
- [x] 3.4 Add unit tests for the collaborator (mirroring `system-prompt-assembler.test.ts`'s mocked-injector pattern) asserting `systemInstructions` never contains stage content and custom-prompt/workflow-instruction ordering is preserved.
- [x] 3.5 Add integration tests for the new stage-instructions injector mirroring `decision-context-injector.test.ts`'s DCI-1..7 structure.

## 4. Wire the collaborator into all 5 call sites

- [x] 4.1 Update `TransitionExecutor` to use the shared collaborator; remove its inline `SystemPromptAssembler`/`addCustomPrompts`/`assemble()` calls; update `userContent` join to `[historyBlock, decisionsBlock, stageInstructionsBlock, resolvedPrompt]`.
- [x] 4.2 Update `HumanTurnExecutor`'s normal execution path the same way.
- [x] 4.3 Update `HumanTurnExecutor`'s "Engine session lost" recovery/fallback branch (currently builds `fallbackAssembler` inline) to use the same shared collaborator.
- [x] 4.4 Update `RetryExecutor` to use the shared collaborator, prepending `stageInstructionsBlock` to `retryPrompt` (no `historyBlock`/`decisionsBlock` — these don't apply to retries).
- [x] 4.5 Update `CodeReviewExecutor` to use the shared collaborator, prepending `stageInstructionsBlock` to `reviewText` (no `historyBlock`/`decisionsBlock`).
- [x] 4.6 Remove now-dead code: any leftover per-executor `SystemPromptAssembler` instantiation/import that's no longer needed directly (executors should depend on the new shared collaborator instead).
- [x] 4.7 Replace `transition-executor.test.ts`'s `TP-1`/`TP-2` placeholder assertions (`expect(true).toBe(true)`) with real assertions verifying `systemInstructions` never contains stage content and custom-prompt ordering is preserved.
- [x] 4.8 Add new test coverage for `HumanTurnExecutor`'s "Engine session lost" fallback branch verifying it receives the same decisions/stage-instructions treatment as the normal path (using `TestEngine(true)`, the existing trigger mechanism from `HT-3`/`HT-GC-2`).
- [x] 4.9 Extend `retry-executor.test.ts`/`code-review-executor.test.ts` with assertions that `stageInstructionsBlock` is correctly prepended to their prompts when due.
- [x] 4.10 Add a dedicated regression test asserting `systemInstructions` is byte-identical across two column transitions on the same conversation/model with differing `stage_instructions` configured per column.

## 5. PiSessionManager qualified-model-id gating

- [x] 5.1 Change `PiSessionManager.sessions` from `Map<number, AgentSession>` to `Map<number, { session: AgentSession; qualifiedModelId: string }>` (or equivalent `SessionEntry` type).
- [x] 5.2 Update `getOrCreate()` signature to accept a new `qualifiedModelId: string` parameter; on reuse, only overwrite `agent.state.systemPrompt` (and update the stored qualified id) when the incoming id differs from the stored one.
- [x] 5.3 Update `get()`, `dispose()`, `disposeAll()` to unwrap the new map value shape.
- [x] 5.4 Update `PiEngine.execute()` (and any other `getOrCreate()` call sites in `pi/engine.ts`) to pass the qualified model id (`modelOverride`) through.
- [x] 5.5 Update existing tests (`src/bun/test/pi-engine.test.ts`, `src/bun/test/pi/session-manager.test.ts`) for the new signature/map shape.
- [x] 5.6 Add new `SM-*` test cases to `pi/session-manager.test.ts`: same qualified model id on reuse → `systemPrompt` untouched even when a new value is passed; different qualified model id → `systemPrompt` overwritten and stored id updated.

## 6. Verification

- [x] 6.1 Run `bun test src/bun/test --timeout 20000` and fix any regressions surfaced by the executor/session-manager changes.
- [x] 6.2 Manually trace one column-transition scenario end-to-end (e.g. via existing config fixtures) to confirm `systemInstructions` is byte-identical across the transition and `stageInstructionsBlock` appears correctly in `userContent`.
- [x] 6.3 Run `openspec validate fix-stage-instructions-cache-invalidation --strict` once more before archiving.


## 7. Refinement: explicit active_directive framing + cancellation

- [x] 7.1 Wrap `stage_instructions` content in `StageInstructionsInjector` with the fixed `<active_directive>` template (instruction text + invariant "in force" sentence), replacing the previous unframed raw text.
- [x] 7.2 Replace the silent `undefined` early-return for a column with no `stage_instructions` with an explicit fixed cancellation `<active_directive>` block, sent at every injection-due point (transition or first turn after compaction) via the same re-injection state machine used by the real directive.
- [x] 7.3 Update `stage-instructions-injector.test.ts` (SI-1/SI-1b/SI-2/SI-6/SI-6b/SI-6c) to assert the new wrapped/cancellation content and that tracking state is touched for the cancellation case too.
- [x] 7.4 Update `transition-executor.test.ts`, `retry-executor.test.ts`, `human-turn-executor.test.ts`, and `copilot-rpc-scenarios.test.ts` assertions that previously expected raw unframed `stageInstructionsBlock` text to expect the new `<active_directive>`-wrapped/cancellation format.
- [x] 7.5 Update `design.md`, `proposal.md`, and `specs/stage-instructions-injection/spec.md` with the new active_directive/cancellation requirements and scenarios.
- [x] 7.6 Run full backend suite (`bun test src/bun/test --timeout 20000`), typecheck (`tsc --noEmit -p tsconfig.backend.test.json`), and `bun test e2e/api --timeout 30000` — all green.
