## MODIFIED Requirements

### Requirement: StubDecisionContextInjector for executor DI tests
`HumanTurnExecutor` and `TransitionExecutor` tests SHALL use a `StubDecisionContextInjector extends DecisionContextInjector` that overrides `prepare()` with a configurable return value and a call-count tracker. The stub SHALL be instantiated in the executor factory functions (`makeExecutor()`) alongside the existing stubs.

#### Scenario: HTE-D-1 — stub returns block, block prepended to engineContent
- **WHEN** `StubDecisionContextInjector.prepare()` is configured to return `"<decisions>…</decisions>"`
- **THEN** the `ExecutionParams` built by `HumanTurnExecutor` has `engineContent` prefixed with the decisions block

#### Scenario: HTE-D-2 — stub returns undefined, no prepend
- **WHEN** `StubDecisionContextInjector.prepare()` is configured to return `undefined`
- **THEN** the `ExecutionParams` built does NOT contain a decisions prefix

#### Scenario: HTE-D-3 — prepare() is called (not skipped)
- **WHEN** `HumanTurnExecutor.execute()` runs
- **THEN** the stub's `prepare()` call count is `1`
