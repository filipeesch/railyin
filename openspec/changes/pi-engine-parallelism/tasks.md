## 1. Configuration surface

- [ ] 1.1 Extend `PiEngineConfig` in `src/bun/config/index.ts` with `providers[*].max_inflight`, `providers[*].queue_timeout_ms`, `harness.delegate.{enabled,max_per_call,max_concurrency,allow_tools}`, `harness.background_compaction.{enabled,early_margin_tokens}`. Apply defaults at parse time.
- [ ] 1.2 Add validation: reject `max_per_call` outside 1..10 and `early_margin_tokens` below 1024 with a clear engine-startup error naming the offending field.
- [ ] 1.3 Update `config/engines.yaml.sample` Pi block with documented examples for the new keys and a vLLM/Ollama/LM Studio matrix.

## 2. Provider concurrency limiter

- [ ] 2.1 Create `src/bun/engine/pi/provider-limiter.ts` exporting `ProviderLimiterRegistry` keyed by provider name. Implement bounded semaphore with FIFO wait queue, abort-aware `acquire(provider, signal)`, non-blocking `tryAcquire(provider)`, and per-provider `queue_timeout_ms` enforcement.
- [ ] 2.2 Maintain per-provider counters: `inFlight`, `queueDepth`, `recentRejectCount`, and a rolling p50 latency window. Expose a pure `snapshot()` method that does not mutate state.
- [ ] 2.3 At engine construction, log a single warning when any configured provider has `max_inflight > 2` and its `base_url` host is `localhost`/`127.0.0.1` with port `1234`.

## 3. Transport wrapper and HTTP pool

- [ ] 3.1 Create `src/bun/engine/pi/provider-transport.ts` exporting a Pi-SDK `Transport` wrapper that maps `model.provider` → limiter, awaits `acquire` before issuing the call, and releases on stream end / error / abort.
- [ ] 3.2 Maintain a shared `undici.Agent` (or equivalent) keyed by provider `base_url` with `keepAlive: true`; reuse it across all sessions to the same base URL.
- [ ] 3.3 Wire the new transport into `defaultSessionFactory` in `src/bun/engine/pi/engine.ts` so every `AgentSession` created by `PiEngine` uses it.

## 4. `getPiProviderStatus()` helper

- [ ] 4.1 Add `getPiProviderStatus()` to `src/bun/engine/pi/engine.ts` (or a new `pi-status.ts`) returning `{ inFlight, queueDepth, p50LatencyMs, recentRejectCount }` per configured provider.

## 5. Child session factory

- [ ] 5.1 Create `src/bun/engine/pi/child-session.ts` with `createChildSession(parent, opts)`:
  - reuses parent's model, providers, auth, dialect, system prompt + a short subagent suffix
  - uses a unique temp `.jsonl` under `~/.railyin/pi-sessions/delegate-${parentConversationId}/${jobId}.jsonl`
  - builds tool set via `buildAllTools({ columnGroups: opts.toolGroups })` plus a filtered read-only subset of `COMMON_TOOL_DEFINITIONS`
  - returns a disposable session that also deletes its temp file on dispose
- [ ] 5.2 Ensure the child session goes through the same `Transport` (limiter + pool) as the parent.
- [ ] 5.3 Add an injectable `ChildSessionFactory` type so tests can substitute fake sessions.

## 6. `delegate` tool

- [ ] 6.1 Create `src/bun/engine/pi/tools/delegate.ts` implementing the tool per the spec (params validation, child spawning, `Promise.allSettled`, markdown digest, structured details, finally-dispose).
- [ ] 6.2 Compute effective concurrency as `min(model_max_concurrency, harness.delegate.max_concurrency, max_per_call, tasks.length, provider.max_inflight)`.
- [ ] 6.3 Forward each child raw inbound model event through the parent execution's `onRawModelMessage` with `parentToolCallId` and `sessionId = "${parentConversationId}/${jobId}"`.
- [ ] 6.4 Emit `tool_execution_update` events on the parent stream with `{ jobId, phase, lastToolName?, lastAssistantChunk? }`; ensure these are not persisted into the parent agent's transcript.
- [ ] 6.5 On parent abort signal: invoke `child.abort()` on every running child, ensure limiter slots release, and do not produce a tool result.
- [ ] 6.6 Extract a shared `formatPiError(error: Error): string` helper covering the existing `tree_reduce` rewrite from `engine.ts` and use it for both parent failures and per-child error sections.

## 7. Tool registration

- [ ] 7.1 Register `delegate` as a new tool group `"delegate"` in `src/bun/engine/pi/tools/index.ts` (`PI_TOOL_GROUPS`).
- [ ] 7.2 Add `"delegate"` to the SDK allowlist in `defaultSessionFactory` in `engine.ts`. Default group set unchanged.
- [ ] 7.3 Ensure the `"delegate"` group is NOT included in any child's tool set, regardless of `allow_tools`.

## 8. Opportunistic background compaction

- [ ] 8.1 In `engine.ts`, on every `turn_end` event for the parent session, compute `softThreshold = contextWindow - (reserveTokens + harness.background_compaction.early_margin_tokens)` and apply the trigger rule from the spec.
- [ ] 8.2 Use `limiter.tryAcquire(provider)` (never `acquire`) to gate the trigger. If `null`, skip; do not queue.
- [ ] 8.3 Maintain `Map<conversationId, Promise<void>>` for in-flight background compactions to prevent double-trigger; clear on settle.
- [ ] 8.4 On success, append the compaction summary via `appendMessage(db, null, conversationId, "compaction_summary", null, result.summary)` (reuse existing path).
- [ ] 8.5 In `PiEngine.shutdown()`, call `session.cancelCompaction()` on every session that has a background compaction in flight before disposing.

## 9. Tests

- [ ] 9.1 `src/bun/test/pi/provider-limiter.test.ts` — FIFO ordering, abort during wait releases queue slot, release after request error, `queue_timeout_ms` triggers rejection, `tryAcquire` returns null when saturated.
- [ ] 9.2 `src/bun/test/pi/child-session.test.ts` — child tool set excludes write/shell/board-mutating/delegate; temp file deleted on dispose.
- [ ] 9.3 `src/bun/test/pi/delegate.test.ts` (using `ChildSessionFactory` injection) — three concurrent jobs, per-job error isolation, `max_per_call` validation, disallowed tool group rejection, parent abort cancels children, digest format, `tool_execution_update` events emitted but not in parent context.
- [ ] 9.4 `src/bun/test/pi/background-compaction.test.ts` — soft-threshold math, no double-trigger while inflight, `tryAcquire` returning null skips compaction, success path appends `compaction_summary` message, `shutdown()` calls `cancelCompaction()`.
- [ ] 9.5 `src/bun/test/pi/config.test.ts` — invalid `max_per_call` and `early_margin_tokens` reject at construction; LM Studio default-mismatch warning fires under the documented conditions.

## 10. Documentation

- [ ] 10.1 Update `config/engines.yaml.sample` Pi section with worked examples for `harness.delegate` and `harness.background_compaction`.
- [ ] 10.2 Update `CLAUDE.md` and/or `README.md` (whichever currently documents Pi) with a short section describing the `delegate` tool, the limiter, and background compaction. Reference defaults and the LM Studio warning.
- [ ] 10.3 Run the full backend test suite (`bun test src/bun/test --timeout 20000`) and confirm pre-existing tests still pass.
