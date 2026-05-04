## Context

The `fix-copilot-lease-timeout` change fixes three compounding bugs in the Copilot engine's lease management. The fixes involve timing-sensitive runtime behaviour (eviction guards, watchdog heartbeats, pre-eviction abort signals) that cannot be verified visually and would regress silently without automated tests.

Current test infrastructure:
- `lease-registry.test.ts` — pure unit, real short timers (20ms), no fake timers used anywhere in the suite
- `copilot-events.test.ts` — unit tests for `translateCopilotStream` with `MockCopilotSession`
- `copilot-rpc-scenarios.test.ts` — integration via `BackendRpcRuntime` + `MockCopilotSdkAdapter` + in-memory SQLite

Two testability gaps in the production code require small targeted refactorings:
1. `DefaultCopilotSdkAdapter` is not exported — can't instantiate directly in unit tests
2. `IDLE_TIMEOUT_MS` / `MAX_SILENCE_COUNT` are hardcoded module constants — watchdog tests would need 2-minute real-time waits

## Goals / Non-Goals

**Goals:**
- Cover all three bugs with automated tests that fail without the fix and pass with it
- Prove the DI refactor doesn't break session lifecycle behaviour (regression guards)
- Keep tests deterministic: use real short timers, no `vi.useFakeTimers()`
- Minimal production surface changes — only what's needed to remove hardcoded constants

**Non-Goals:**
- Playwright / E2E tests — the failure mode is internal engine state, not UI-visible behaviour
- Testing the full happy path for Copilot streaming (already covered by existing tests)
- Performance or load tests

## Decisions

### 1. Export `DefaultCopilotSdkAdapter`

Export the class from `session.ts` so unit tests can instantiate it directly with a fast injected `LeaseRegistry`. The alternative (testing through the factory only) would require observable side effects to be threaded through the `CopilotSdkAdapter` interface — more coupling for less clarity.

### 2. Flat optional params on `translateCopilotStream`

Replace `IDLE_TIMEOUT_MS = 120_000` and `MAX_SILENCE_COUNT = 3` hardcoded constants with optional flat params with the same defaults. This matches the existing `LeaseRegistry` pattern (constructor takes `idleTimeoutMs`). An options object would work equally well but adds indirection for two fields.

### 3. Three-layer test structure

```
Layer 1 — copilot-events.test.ts        (Bug B watchdog heartbeat)
Layer 2 — copilot-sdk-adapter.test.ts   (Bug A eviction guard + Bug C onBeforeEvict)
Layer 3 — copilot-rpc-scenarios.test.ts (Bug C end-to-end + Bug B smoke)
```

Rationale: each layer tests the narrowest surface that exercises the bug. Integration tests (Layer 3) are only used where unit tests cannot isolate the end-state (`cancelled` vs `failed` requires the full orchestrator path).

### 4. `MockCopilotSdkAdapter.triggerBeforeEvict` is a test helper, not interface method

`CopilotSdkAdapter.onBeforeEvict` is the real interface method (registered by the engine). `triggerBeforeEvict` is a test-side utility on the mock that fires the stored callbacks — it is not on the interface. This avoids polluting the production interface with test concerns.

### 5. No fake timers

Consistent with the entire test suite. Tests use real short timers (10–50ms) and real `await` delays. This keeps tests closer to production behaviour and avoids brittle timer mocking.

## Risks / Trade-offs

- **Flaky timers** → keep `idleTimeoutMs` at ≥ 10ms and polling windows at ≥ 2.5× the interval to tolerate CI slowdown
- **A4 (5s deadline test)** is necessarily slow (~5.5s) — isolate it or mark with a longer timeout comment so it doesn't mislead reviewers
- **Renumbering tasks in original change** — tasks 1.1–1.5 become 1.1–1.6 after the export task is added; SQL tracking table will need re-sync
