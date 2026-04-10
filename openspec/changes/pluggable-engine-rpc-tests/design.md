## Context

Railyin already has UI-oriented integration tests and a small set of orchestrator/native-engine tests, but the Copilot path still lacks a deterministic backend validation layer. The current seams are close but not yet reusable: task RPC handlers depend on the concrete `Orchestrator`, the Copilot engine is wired directly to module-level SDK session helpers, and existing tests either bypass the real Copilot engine or depend on UI automation.

This change needs to support two things at once: testing the real Copilot engine implementation with mocked Copilot SDK classes, and establishing the same test architecture for future backends such as Claude Code. That makes this a cross-cutting design change across handlers, coordinator wiring, engine construction, and test support.

## Goals / Non-Goals

**Goals:**
- Add a reusable backend RPC scenario harness that drives real task RPC handlers and inspects callback emissions, database persistence, and execution state.
- Allow scenario tests to inject a real coordinator backed by a real engine implementation and an engine-specific SDK mock adapter.
- Make Copilot engine behaviors such as resume, create fallback, streaming, tool execution, cancellation, and model listing testable without live Copilot credentials.
- Define stable cancellation semantics for non-native engines so shared scenario assertions can be reused across backends.

**Non-Goals:**
- Replacing the existing UI automation suite.
- Adding a live end-to-end Copilot credential test as part of this change.
- Implementing the Claude Code engine itself.
- Reworking native engine tests unless required to preserve shared coordinator contracts.

## Decisions

### 1. Introduce an `ExecutionCoordinator` contract above the concrete orchestrator
Task RPC handlers will depend on an interface-shaped coordinator contract that matches the operations they already use: transition, human turn, retry, code review, cancel, and model listing. Production will still instantiate the current `Orchestrator`, but tests will inject it through the contract instead of referencing the concrete class directly.

Rationale:
- Keeps the shared scenario suite reusable across future backends and coordinator implementations.
- Avoids duplicating handler tests for each engine implementation.

Alternatives considered:
- Keep handlers coupled to `Orchestrator`: simpler short-term, but blocks reusable runtime injection.
- Test engines directly and skip RPC handlers: faster, but misses the actual backend contract used by the product.

### 2. Inject engine-specific SDK adapters into real engine implementations
`CopilotEngine` will receive an SDK adapter abstraction that owns client creation, session creation/resume, abort, disconnect, and model listing. Production wiring will use a default adapter backed by `@github/copilot-sdk`; tests will provide a `MockCopilotSdkAdapter`. Future engines such as Claude Code will follow the same pattern with their own adapter types and mocks.

Rationale:
- Tests validate the real engine logic instead of substituting a fake `ExecutionEngine`.
- SDK mock classes can model actual session behavior, including streaming, tool events, failures, and cancellation.

Alternatives considered:
- Monkey-patch module-level SDK helpers: workable for one engine, but brittle and hard to scale.
- Replace the whole engine with a fake event emitter: easier, but it stops testing engine-specific integration logic.

### 3. Build a shared backend runtime harness around real RPC handlers
The reusable test runtime will assemble an in-memory database, task fixtures, callback recorders, database probes, async waiters, and the task RPC handler map. Shared scenario files will invoke RPC handlers such as `tasks.sendMessage`, `tasks.retry`, and `tasks.cancel`, then assert on callback emissions and persisted state.

Rationale:
- Exercises the real backend seam the UI relies on without requiring UI automation.
- Keeps the scenarios engine-agnostic while still testing engine-specific implementations through injected coordinators.

Alternatives considered:
- UI-only tests: too slow and too coupled to rendering details.
- Orchestrator-only tests: misses handler-level return values and RPC contract behavior.

### 4. Standardize scenario settling on callback and database barriers
The runtime harness will avoid sleep-based assertions. Scenario completion will be detected through observable barriers such as `onToken(...done=true)`, terminal task updates, execution status changes, and expected message counts.

Rationale:
- Reduces flakiness and keeps engine-specific mocks deterministic.
- Allows the same scenario definitions to run against multiple backends without timing assumptions.

Alternatives considered:
- Fixed sleep intervals: easy to write, but fragile and slow.

### 5. Use dual-state cancellation semantics for non-native engines
When a backend execution is cancelled, the execution record will be terminally marked `cancelled`, while the task will transition to `waiting_user` so the next user message can resume work naturally. Shared scenario assertions will use this as the backend contract for pluggable engines.

Rationale:
- Separates execution audit state from task readiness.
- Aligns cancellation with interactive chat workflows and future engine reuse.

Alternatives considered:
- Mark both execution and task as `cancelled`: simpler but less resumable.
- Mark both as `waiting_user`: better UX, but loses audit precision on the execution row.

## Risks / Trade-offs

- [Coordinator abstraction leaks implementation details] → Keep the contract limited to the methods already required by task handlers.
- [SDK adapters diverge across engines] → Treat the scenario suite as coordinator-level and keep SDK mock details engine-specific.
- [Cancellation semantics conflict with existing non-native behavior] → Update the execution-engine spec and shared tests together so the new contract is explicit.
- [Test support utilities become another monolith] → Split runtime factory, callback recorder, DB probes, and scenario helpers into focused modules.

## Migration Plan

1. Introduce the coordinator contract and update task handlers to depend on it.
2. Add the Copilot SDK adapter abstraction with a production implementation that wraps the existing SDK calls.
3. Build the backend runtime harness and shared scenario modules.
4. Port Copilot backend coverage to the new harness using mocked Copilot SDK classes.
5. Align non-native cancellation persistence with the shared contract.
6. Add future engine adapters and reuse the same scenarios as those engines are introduced.

## Open Questions

- Should shared scenario support live alongside `src/bun/test` or under a dedicated `src/bun/test-support/engine` area?
- Should the future Claude Code engine use the same orchestrator class or a distinct coordinator implementation behind the same contract?
