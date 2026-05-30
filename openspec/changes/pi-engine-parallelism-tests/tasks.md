## 1. Prerequisites

- [ ] 1.1 Confirm `pi-engine-parallelism` tasks 2.x (ProviderLimiter extraction), 6.x (validatePiEngineConfig), 8.x (bg compaction DI seam), and 7.x (buildDelegateTool with childSessionFactory) are merged before writing tests that depend on them
- [ ] 1.2 Add `InMemoryProviderLimiter` test stub to `src/bun/test/helpers.ts` (or a new `src/bun/test/pi/fixtures/InMemoryProviderLimiter.ts`): `{ tryAcquire(): release | null, release(), inFlight: number, queueDepth: number }` — injectable into engine bg compaction tests

## 2. ProviderLimiter Unit Tests

- [ ] 2.1 Create `src/bun/test/pi-provider-limiter.test.ts` with `describe("ProviderLimiter")`
- [ ] 2.2 Add PL-1: default `maxInflight = 8`
- [ ] 2.3 Add PL-2: FIFO — third waiter queued when two slots occupied (`queueDepth === 1`)
- [ ] 2.4 Add PL-3: waiter unblocks after slot release
- [ ] 2.5 Add PL-4: aborted waiter removed — slot not consumed, `queueDepth` decrements
- [ ] 2.6 Add PL-5: `tryAcquire()` returns release fn when slot free; `inFlight` increments
- [ ] 2.7 Add PL-6: `tryAcquire()` returns `null` when all slots taken
- [ ] 2.8 Add PL-7: `queue_timeout_ms` rejects waiter after timeout; queue entry removed
- [ ] 2.9 Add PL-8: LM Studio warning logged for `localhost:1234` with `max_inflight > 2`
- [ ] 2.10 Add PL-9: LM Studio warning suppressed at `max_inflight = 2`
- [ ] 2.11 Add PL-10: `getPiProviderStatus()` snapshot — correct `inFlight`, `queueDepth` fields
- [ ] 2.12 Run `bun test src/bun/test/pi-provider-limiter.test.ts --timeout 20000` — all pass

## 3. Config Validation Unit Tests

- [ ] 3.1 Add `describe("PiEngine config validation")` block to `src/bun/test/pi-engine.test.ts`
- [ ] 3.2 Add CFG-1: `max_per_call = 0` → throws, error names the field
- [ ] 3.3 Add CFG-2: `max_per_call = 11` → throws, error names the field
- [ ] 3.4 Add CFG-3: `early_margin_tokens = 512` → throws, error names the field
- [ ] 3.5 Add CFG-4: valid config → no error
- [ ] 3.6 Add CFG-5: `computeSoftCompactionThreshold(128000, 16384, 8192)` → `103424`
- [ ] 3.7 Run `bun test src/bun/test/pi-engine.test.ts --timeout 20000` — all pass

## 4. Background Compaction Engine Integration Tests

- [ ] 4.1 Add `describe("PiEngine background compaction")` block to `src/bun/test/pi-engine.test.ts`
- [ ] 4.2 Add PE-BGC-1: context above soft threshold + slot free → `compact()` called async, engine continues
- [ ] 4.3 Add PE-BGC-2: context above threshold + `tryAcquire()` returns null → `compact()` NOT called
- [ ] 4.4 Add PE-BGC-3: bg compact already in flight → second `turn_end` does not trigger another
- [ ] 4.5 Add PE-BGC-4: bg compact success with summary → `compaction_summary` row in DB
- [ ] 4.6 Add PE-BGC-5: `engine.shutdown()` with in-flight compaction → `cancelCompaction()` called before dispose
- [ ] 4.7 Run full `pi-engine.test.ts` to confirm all new and existing tests pass

## 5. Delegate Tool Integration Tests

- [ ] 5.1 Create `src/bun/test/pi-delegate.test.ts`
- [ ] 5.2 Add `MockChildSessionFactory` helper: accepts an array of scripted `MockAgentSession` instances, returns one per call in order, records call timestamps for concurrency assertions
- [ ] 5.3 Add DLG-INT-1: two tasks succeed → digest has `### a` and `### b` sections
- [ ] 5.4 Add DLG-INT-2: one of three tasks throws → two success sections + one `**error**:` section
- [ ] 5.5 Add DLG-INT-3: concurrency cap — only `min(N, max_inflight)` children in flight at once (use Deferred-based MockChildSession, not setTimeout)
- [ ] 5.6 Add DLG-INT-4: parent abort → all child `abort()` methods called; limiter slots released
- [ ] 5.7 Add DLG-INT-5: child `tool_start` events forwarded with `parentCallId = delegate_tool_call_id` and `isInternal: true`
- [ ] 5.8 Add DLG-INT-6: temp files under `delegate-${parentConvId}/` removed after success
- [ ] 5.9 Add DLG-INT-7: temp files removed after all-child-failure
- [ ] 5.10 Run `bun test src/bun/test/pi-delegate.test.ts --timeout 20000` — all pass

## 6. Delegate Validation Unit Tests

- [ ] 6.1 Add `describe("delegate tool — validation")` block to `pi-delegate.test.ts`
- [ ] 6.2 Add DLG-VAL-1: `tasks.length > max_per_call` → error result, no children spawned
- [ ] 6.3 Add DLG-VAL-2: duplicate task ids → validation error, no children
- [ ] 6.4 Add DLG-VAL-3: `tools: ["shell"]` with `allow_tools: ["read"]` → error naming rejected group
- [ ] 6.5 Add DLG-VAL-4: empty task id → validation error
- [ ] 6.6 Run tests to confirm all validation cases pass

## 7. Child Tool Set Unit Tests

- [ ] 7.1 Add `describe("delegate tool — child tool set")` block to `pi-delegate.test.ts`
- [ ] 7.2 Add DLG-TOOLS-1: default (no `tools` specified) → child factory receives no `write`/`shell`/`patch_file`/`run_command`/`create_task`/`move_task`/`record_decision`/`update_todo_status`/`decision_request`/`delegate`
- [ ] 7.3 Add DLG-TOOLS-2: default → child tool set includes `read_file`, `grep_files`, `list_dir` and read-only common tools
- [ ] 7.4 Add DLG-TOOLS-3: `delegate` not in child tool set (recursive guard)
- [ ] 7.5 Run tests to confirm all tool-set cases pass

## 8. Playwright Delegate Rendering Tests

- [ ] 8.1 Create `e2e/ui/delegate-rendering.spec.ts`
- [ ] 8.2 Add seed helpers: `makeDelegateMessages(taskId)` — builds the parent `delegate` tool_call, two child tool_call/result pairs with `metadata: { parent_tool_call_id }`, and one assistant digest message
- [ ] 8.3 Add S-D1: badge shows child count `2`
- [ ] 8.4 Add S-D2: expand → two nested child `.tc` cards with correct tool names
- [ ] 8.5 Add S-D3: digest assistant message renders `### a` heading and content
- [ ] 8.6 Add S-D4: children hidden before expand (`.tc__children > .tc` count is `0`)
- [ ] 8.7 Run `bun run build && npx playwright test e2e/ui/delegate-rendering.spec.ts` — all pass

## 9. Final Verification

- [ ] 9.1 Run full backend test suite: `bun test src/bun/test --timeout 20000` — no regressions
- [ ] 9.2 Run full Playwright suite: `bun run build && npx playwright test e2e/ui` — no regressions
- [ ] 9.3 Verify every spec scenario from `specs/pi-engine-parallelism-tests/spec.md` maps to a passing test
