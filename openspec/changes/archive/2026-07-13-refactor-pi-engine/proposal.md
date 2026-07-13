## Why

The Pi agent currently returns "Agent completed with no output. The prompt may not have been resolved correctly." when starting a conversation. This regression appeared after upgrading `@earendil-works/pi-coding-agent` from `^0.74.0` to `^0.80.3`. The production execution loop closes the event queue as soon as `session.prompt()` resolves, but SDK 0.80.3 may still be emitting final text deltas and `agent_end` after that promise resolves. In addition, `PiEngine` has grown into a large class that mixes session lifecycle, execution loop, compaction, tool building, dialect resolution, and context management, making the bug harder to isolate and the code harder to test.

## What Changes

- Decompose `src/bun/engine/pi/engine.ts` into single-responsibility services by lifecycle concern:
  - `PiSessionManager` — create, reuse, and dispose `AgentSession` instances per conversation.
  - `PiExecutionController` — own the `AsyncQueue`, subscribe to SDK events, translate them to `EngineEvent`, and drive the prompt/continue loop.
  - `PiCompactionCoordinator` — own background compaction decisions, the `bgCompactions` map, and resume-after-compaction logic.
  - `PiToolFactory` — encapsulate `buildAllTools` wiring and harness context creation.
  - `PiDialectResolver` — encapsulate slash-command resolution and skill-path discovery.
  - `PiModelBuilder` — build the Pi SDK `Model` object from config and context-window overrides.
- Introduce a `RunDriver` abstraction that wraps `session.prompt()`, `session.agent.continue()`, and `session.agent.waitForIdle()` so the execution controller can be unit-tested without a real SDK session.
- Fix the no-output regression by awaiting `session.agent.waitForIdle()` after each prompt/continue, which the Pi SDK docs document as the public way to wait for the agent to finish processing.
- Keep `PiEngine` as a thin `ExecutionEngine` facade; callers and the engine registry do not change.
- Change `PiEngine`'s constructor to accept injected services and add a `createPiEngine()` convenience factory for production wiring.
- Only pass `systemPromptOverride` to `DefaultResourceLoader` when the resolved system prompt is non-empty, preventing empty system prompts for chat sessions with no task context.
- Remove dead code: `buildCompactionSettings()` (unused in production) and commented-out delegate-emit references.
- Update existing tests and add unit tests for the new services.
- Add a faux-provider integration test that reproduces the no-output regression by scripting an assistant response where `agent_end` and final text deltas arrive after `session.prompt()` resolves.

## Capabilities

### New Capabilities

- `pi-execution-controller`: Explicit, testable management of the Pi SDK event lifecycle (subscribe, translate, queue, prompt/continue/waitForIdle) inside Railyin.
- `pi-run-driver`: Injectable abstraction over the Pi SDK turn driver (`prompt`, `continue`, `waitForIdle`) to enable isolated testing.

### Modified Capabilities

- `pi-engine`: Requirements change from a monolithic engine implementation to a facade over decomposed services. The observable behavior (RPC surface, event types, compaction resume) remains the same, but the internal contract for how turns complete changes: the engine must wait for the SDK run to fully settle before emitting `done`.
- `pi-engine-parallelism`: Background compaction still aborts the active prompt and resumes via `agent.continue()`, but the resume decision moves into `PiCompactionCoordinator` and the wait-for-settlement behavior moves into `PiExecutionController`.

## Impact

- **Code**: `src/bun/engine/pi/engine.ts` becomes a facade; new files under `src/bun/engine/pi/` for the decomposed services. `src/bun/index.ts` updated to use `createPiEngine()`.
- **Tests**:
  - Existing `PiEngine` tests updated for constructor/factory changes.
  - New unit tests for `PiExecutionController` using a mock `RunDriver` and fake SDK event source.
  - New unit tests for `PiCompactionCoordinator` covering threshold math, slot acquisition, double-trigger prevention, mid-turn vs turn-boundary resume, and `MessageAppender` integration.
  - New unit tests for `DefaultRunDriver` verifying `session.prompt()` / `session.agent.continue()` ordering, `session.agent.waitForIdle()` await, abort handling, and limiter slot lifecycle.
  - New unit tests for `PiSessionManager` covering creation, reuse, disposal, and disk restore via an injected `SessionPathResolver`.
  - New faux-provider integration test reproducing the no-output regression and verifying non-empty token stream + `done` event.
- **API/RPC**: No changes. `PiEngine` remains the public `ExecutionEngine` implementation.
- **Dependencies**: No new dependencies.

## Test Coverage

### Unit Tests (new services)

- `PiExecutionController`
  - Subscribes to SDK events, translates them via `translateEvent`, and pushes into an `AsyncQueue`.
  - Drives `RunDriver.start()` and `RunDriver.resume()` until the compaction coordinator reports no more resumes.
  - Closes the queue only after the driver call and any compaction resume settle.
  - Handles SDK errors by emitting a non-fatal `error` event and closing the queue.
  - Cleans up the SDK subscription in `finally`.

- `DefaultRunDriver`
  - Calls `session.prompt(prompt)` then `await session.agent.waitForIdle()`.
  - Calls `session.agent.continue()` then `await session.agent.waitForIdle()`.
  - Acquires a provider limiter slot before the SDK call and releases it in `finally`.
  - Aborts the active turn when the abort signal fires.
  - Rejects if `session.agent.waitForIdle()` rejects.

- `PiCompactionCoordinator`
  - Computes threshold from `contextWindow - (16384 + earlyMarginTokens)`.
  - Triggers background compaction on `turn_end` when usage exceeds threshold.
  - Acquires a non-blocking slot; skips compaction when no slot is available.
  - Prevents double-trigger via `bgCompactions` map.
  - Decides resume-after-compaction based on whether the last message is an assistant message.
  - Appends a non-empty summary via the injected `MessageAppender`.
  - Does not append empty summaries.

- `PiSessionManager`
  - Creates a new `AgentSession` on first use and stores it by `conversationId`.
  - Reuses an existing session on subsequent calls.
  - Disposes a session and removes it from the map.
  - Restores a session from disk via the injected `SessionPathResolver` when no in-memory session exists.

- `PiToolFactory` / `PiDialectResolver` / `PiModelBuilder`
  - Pure-ish wiring tested with fake config and context.
  - `PiModelBuilder` throws when `contextWindowOverride` is missing.
  - `PiDialectResolver` resolves slash prompts to skill file contents.
  - `PiToolFactory` builds harness/common contexts and active tool name lists.

### Facade Integration Tests

- Existing `PiEngine` tests updated to use the new constructor or `createPiEngine()` factory.
- Verify session reuse, tool state preservation, compaction resume, and provider metrics.
- Verify `cancel()` aborts the active session.

### Faux-Provider Regression Test

- Uses `registerFauxProvider` to script an assistant response where `agent_end` and final text deltas arrive after `session.prompt()` resolves.
- Drives `PiEngine.execute()` end-to-end.
- Asserts the stream emits at least one non-empty `token` event before `{ type: "done" }`.
- Asserts no "Agent completed with no output" warning is produced.

### Existing Suites to Keep Passing

- `bun test src/bun/test/pi --timeout 20000`
- `bun test src/bun/test/pi-session-tools-integration.test.ts --timeout 20000`
- `bun test e2e/api --timeout 30000`
