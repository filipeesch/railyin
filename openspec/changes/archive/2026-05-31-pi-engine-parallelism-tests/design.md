## Context

The `pi-engine-parallelism` change introduces a `ProviderLimiter`, `delegate` tool, and background compaction logic — all new surface with no existing test coverage. This design document captures the test infrastructure strategy: which test doubles to use, which files are new vs. extended, and where the seams between production code and test doubles live.

All new production DI seams (`childSessionFactory`, `validatePiEngineConfig`, `computeSoftCompactionThreshold`, `triggerBackgroundCompactionIfNeeded`) are defined in the `pi-engine-parallelism` implementation tasks. This suite depends on those seams existing.

## Goals / Non-Goals

**Goals:**
- Cover all normative scenarios from `pi-engine-parallelism/specs/pi-engine-parallelism/spec.md`
- Use dependency injection for all doubles — no monkey-patching, no test-only code paths in production
- Keep unit tests fast (no I/O, no SDK, no network)
- Keep integration tests self-contained (MockAgentSession, in-memory DB)
- Keep Playwright tests static (pre-seeded messages, no live WS)

**Non-Goals:**
- SDK transport internals — the `Transport` wrapper is wired in `defaultSessionFactory`; unit tests cover the limiter contract; HTTP-level concurrency is an acceptance concern
- Real vLLM concurrency verification — manual acceptance only
- End-to-end compaction flow (session prompt → auto-compact → retry) — deferred; too much SDK surface to mock reliably

## Decisions

### D1: Three test layers

```
Unit   src/bun/test/pi-provider-limiter.test.ts   ProviderLimiter pure class — no SDK, no DB
Unit   src/bun/test/pi-engine.test.ts additions   config validation + bg compaction policy
Integ  src/bun/test/pi-delegate.test.ts           delegate tool with MockAgentSession + in-memory DB
UI     e2e/ui/delegate-rendering.spec.ts          static parentCallId nested-card rendering
```

Unit tests run with Vitest, zero I/O. Integration tests use the existing `MockAgentSession` + in-memory SQLite pattern from `pi-engine.test.ts`. Playwright tests use static `conversations.getMessages` mock (same shape as `tool-rendering.spec.ts` S-26).

### D2: MockChildSessionFactory for delegate tests

`buildDelegateTool(opts)` accepts `childSessionFactory?: ChildSessionFactory`. Tests inject a factory that returns scripted `MockAgentSession` instances (same class as in `pi-engine.test.ts`). Concurrency-cap tests use a factory that records call order via a shared counter and resolves after a configurable delay. This covers the "only N in-flight at once" scenario without any real HTTP.

### D3: InMemoryProviderLimiter for engine integration tests

For bg compaction tests in `pi-engine.test.ts`, a simple `InMemoryProviderLimiter` is injected:
- `tryAcquire()` returns `true` or `false` based on a flag set in the test
- `release()` records calls for assertion

This avoids re-testing `ProviderLimiter` internals (covered in its own unit file) while still exercising the engine's trigger/skip/no-double logic.

### D4: parentCallId captured via event collector

Delegate integration tests collect all `tool_start`/`tool_result` events emitted on the parent stream's `AsyncQueue`. Assertions check that each child event has `parentCallId === delegate_tool_call_id`. No live UI needed — this is a stream-level assertion.

### D5: Playwright reuses S-26 fixture shape

`delegate-rendering.spec.ts` seeds `conversations.getMessages` with a pre-built message array:
- One `tool_call` message: `delegate` with `callId: "tc-delegate"`
- Two child `tool_call` + `tool_result` pairs with `metadata: { parent_tool_call_id: "tc-delegate" }`
- One `assistant` message containing the digest markdown

This is identical to how `tool-rendering.spec.ts` tests S-26 (`spawn_agent`). Badge count, expand/collapse, and digest rendering are asserted with no live WS.

### D6: fix-pi-autocompact-tests ordering dependency

`fix-pi-autocompact-tests` modifies the `PiEngine` constructor (adds `ModelSettingsRepository` param). Our `pi-engine.test.ts` additions will need that param in `makePiEngine()`. The `MockModelSettingsRepository` stub defined in that change is reused here. Tests in this suite should be written to be forward-compatible: always pass a `NullModelSettingsRepository` (already in the codebase) as the stub.

## Risks / Trade-offs

- [Concurrency assertion fragility] → Timer-based delays in `MockChildSessionFactory` can be flaky in CI. Mitigation: use a `Deferred`/`Semaphore` approach (resolve manually per step) rather than `setTimeout`.
- [fix-pi-autocompact-tests merge order] → If that change lands after ours, `pi-engine.test.ts` additions will fail to compile. Mitigation: use `NullModelSettingsRepository` (already present) so no dep on that change's stub.
