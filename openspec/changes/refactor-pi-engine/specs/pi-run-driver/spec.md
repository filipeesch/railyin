# Pi Run Driver

## Purpose

Specifies the `RunDriver` abstraction that wraps the Pi SDK's prompt/continue/waitForIdle lifecycle. It isolates the execution controller from direct SDK calls and makes the controller unit-testable.

## Requirements

### Requirement: Interface definition
`RunDriver` SHALL be an interface with two methods:

```ts
export interface RunDriver {
  start(session: AgentSession, prompt: string, signal?: AbortSignal): Promise<void>;
  resume(session: AgentSession, signal?: AbortSignal): Promise<void>;
}
```

`start()` corresponds to the initial user prompt; `resume()` corresponds to `session.agent.continue()` after a background compaction.

### Requirement: Default SDK implementation
`DefaultRunDriver` SHALL implement `RunDriver` using the public Pi SDK APIs only:

- `start()` SHALL call `await session.prompt(prompt)` and then `await session.agent.waitForIdle()`.
- `resume()` SHALL call `await session.agent.continue()` and then `await session.agent.waitForIdle()`.

Both methods SHALL accept an optional `AbortSignal` and pass it to the SDK calls where supported. If the signal aborts, the method SHALL reject with an `AbortError`.

#### Scenario: start() prompts and waits
- **WHEN** `runDriver.start(session, "hello")` is called
- **THEN** `session.prompt("hello")` is awaited
- **AND THEN** `session.agent.waitForIdle()` is awaited

#### Scenario: resume() continues and waits
- **WHEN** `runDriver.resume(session)` is called
- **THEN** `session.agent.continue()` is awaited
- **AND THEN** `session.agent.waitForIdle()` is awaited

#### Scenario: Abort signal propagates
- **WHEN** the abort signal fires during `start()`
- **THEN** the returned promise rejects with an `AbortError`

### Requirement: No direct queue manipulation
`RunDriver` implementations SHALL NOT create, close, or push events to the `AsyncQueue`. Their only responsibility is to drive the SDK run to a settled state.

#### Scenario: Driver does not close queue
- **WHEN** `runDriver.start()` resolves
- **THEN** the `AsyncQueue` owned by the controller is still open

### Requirement: Concurrency limiter integration
`DefaultRunDriver` SHALL wrap the SDK calls with the provider concurrency limiter via the existing `runWithLimiter` helper (or equivalent service method). The limiter slot SHALL be acquired before the SDK call and released after `waitForIdle()` settles.

#### Scenario: Limiter slot held for full run
- **WHEN** `runDriver.start()` is called
- **THEN** a slot is acquired from the provider limiter before `session.prompt()`
- **AND** the slot is released only after `session.agent.waitForIdle()` resolves

#### Scenario: Limiter slot released on error
- **WHEN** `session.prompt()` rejects
- **THEN** the limiter slot is released and the error propagates

### Requirement: Test double support
The interface SHALL be simple enough to mock in unit tests. A test double can resolve immediately and optionally emit events via a callback supplied by the test.

#### Scenario: Mock driver resolves without SDK calls
- **WHEN** a test injects a mock `RunDriver` that resolves immediately
- **THEN** `PiExecutionController` completes without calling the real SDK

### Requirement: Unit-testable ordering and error paths
`DefaultRunDriver` unit tests SHALL use a fake `AgentSession` and a fake `ProviderLimiterRegistry` to verify call ordering, slot lifecycle, and error propagation without touching the real Pi SDK or a real LLM provider.

#### Scenario: start() call order is prompt → waitForIdle → release slot
- **GIVEN** a fake session recording `prompt`, `agent.waitForIdle`, and `agent.continue` calls
- **WHEN** `runDriver.start(session, "hello")` resolves
- **THEN** the call log is `["acquire", "prompt", "waitForIdle", "release"]`

#### Scenario: resume() call order is continue → waitForIdle → release slot
- **GIVEN** a fake session recording the same calls
- **WHEN** `runDriver.resume(session)` resolves
- **THEN** the call log is `["acquire", "continue", "waitForIdle", "release"]`

#### Scenario: waitForIdle rejection releases slot and propagates error
- **GIVEN** a fake session whose `agent.waitForIdle()` rejects with `Error("idle timeout")`
- **WHEN** `runDriver.start(session, "hello")` is awaited
- **THEN** the promise rejects with the same error and the limiter slot is released

#### Scenario: abort signal rejects the driver promise
- **GIVEN** an `AbortController` whose signal is aborted immediately
- **WHEN** `runDriver.start(session, "hello", signal)` is awaited
- **THEN** the promise rejects with an `AbortError` and no slot remains held
