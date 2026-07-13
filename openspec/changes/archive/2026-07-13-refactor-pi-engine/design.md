## Context

The Pi agent in Railyin (`src/bun/engine/pi/engine.ts`) currently mixes several responsibilities in one large class: session creation/reuse, execution loop management, background compaction decisions, tool/harness wiring, dialect resolution, and model building. This made it hard to isolate the root cause of the "Agent completed with no output" regression that appeared after upgrading `@earendil-works/pi-coding-agent` from `^0.74.0` to `^0.80.3`.

Investigation showed that the regression is caused by the execution loop closing the `AsyncQueue` as soon as `session.prompt()` resolves. In SDK 0.80.3, final events (including `agent_end` and trailing text deltas) can still be in flight after that promise resolves. The SDK docs document `await session.agent.waitForIdle()` as the public way to wait for the agent to finish processing. The integration tests were already updated to wait for both `agent_end` and the prompt promise; production code was not.

The codebase already has strong patterns for config-driven behavior, typed RPC contracts, and separation between backend handlers and frontend stores. The Pi engine refactor should follow those patterns and produce services that are independently testable.

## Goals / Non-Goals

**Goals:**
- Fix the no-output regression by waiting for the SDK run to fully settle before emitting `done`.
- Decompose `PiEngine` into single-responsibility services aligned with lifecycle concerns.
- Keep `PiEngine` as the public `ExecutionEngine` facade so callers and the engine registry do not change.
- Make the execution loop unit-testable without a real Pi SDK session.
- Remove dead code discovered during the refactor (`buildCompactionSettings()`, commented-out delegate emit refs).
- Fix the empty-system-prompt issue by only passing `systemPromptOverride` when the resolved system prompt is non-empty.
- Preserve all existing observable behavior: event types, RPC surface, background compaction resume, delegate tool, provider metrics.

**Non-Goals:**
- No changes to the shared RPC types or frontend stores.
- No changes to workflow YAML or prompt files.
- No new external dependencies.
- No changes to the `ExecutionEngine` interface itself.
- No changes to the provider concurrency limiter algorithm or HTTP transport behavior.

## Decisions

### 1. Decompose by lifecycle concern
**Decision:** Split `PiEngine` into `PiSessionManager`, `PiExecutionController`, `PiCompactionCoordinator`, `PiToolFactory`, `PiDialectResolver`, and `PiModelBuilder`.
**Rationale:** Each service maps to a distinct phase of a Pi turn: session lifecycle, execution loop, compaction, tools, dialect resolution, and model construction. This avoids god classes and makes each piece independently testable.
**Alternative considered:** Decompose by data flow (input, process, output). Rejected because the lifecycle boundaries match the SDK's own phases and make the concurrency/compaction logic easier to isolate.

### 2. Keep a thin `PiEngine` facade
**Decision:** `PiEngine` remains the only public `ExecutionEngine` implementation. It delegates to the new services.
**Rationale:** The engine registry in `src/bun/index.ts` and all callers already depend on `ExecutionEngine`. Keeping the facade avoids a broad refactor across the codebase.
**Alternative considered:** Expose multiple services to callers. Rejected because it would leak internal decomposition and complicate the registry.

### 3. Introduce a `RunDriver` abstraction
**Decision:** Create a `RunDriver` interface with `start()` and `resume()` methods, implemented by `DefaultRunDriver` using `session.prompt()`, `session.agent.continue()`, and `session.agent.waitForIdle()`.
**Rationale:** The execution controller needs to drive the SDK without being tightly coupled to it. A narrow interface makes the controller testable and captures the exact public SDK surface we rely on.
**Alternative considered:** Have the controller call the SDK directly. Rejected because it would make unit tests require a real or heavily mocked SDK session.

### 4. Await `session.agent.waitForIdle()` after each prompt/continue
**Decision:** `DefaultRunDriver` calls `await session.agent.waitForIdle()` after `session.prompt()` and `session.agent.continue()` resolve.
**Rationale:** This is the documented public API for waiting until the agent has finished processing. It fixes the regression where final events were dropped because the queue closed too early.
**Alternative considered:** Poll for `agent_end` or add a timeout heuristic. Rejected because `waitForIdle()` is the SDK-provided, documented mechanism.

### 5. Move compaction decision-making into `PiCompactionCoordinator`
**Decision:** `PiCompactionCoordinator` owns the `bgCompactions` map, threshold math, and resume-after-compaction decision. `PiExecutionController` only observes events and awaits compaction.
**Rationale:** Compaction logic is complex (thresholds, slots, abort handling, resume rules) and deserves its own home. Isolating it prevents the execution loop from becoming a god method.
**Alternative considered:** Keep compaction logic inline in the execution loop. Rejected because it would recreate the monolithic structure we are trying to eliminate.

### 6. Change `PiEngine` constructor and add `createPiEngine()` factory
**Decision:** `PiEngine` accepts injected services in its constructor. Production wiring uses a `createPiEngine()` factory in `src/bun/engine/pi/pi-engine-factory.ts`.
**Rationale:** Dependency injection supports unit testing and follows the project's preference for loose coupling. A factory keeps `src/bun/index.ts` clean.
**Alternative considered:** Keep the existing constructor and instantiate services internally. Rejected because it hides dependencies and makes testing harder.

### 7. Remove `buildCompactionSettings()` and commented-out delegate emit refs
**Decision:** Delete `buildCompactionSettings()` from `engine.ts` and remove the test that asserts it. Remove commented-out `delegateEmitRefs` code.
**Rationale:** Dead code adds noise and maintenance burden. The production path hardcodes `enabled: false` in `SettingsManager.inMemory()`.
**Alternative considered:** Keep the helper for future use. Rejected because it is not used and has no clear future use.

### 8. Only pass `systemPromptOverride` when non-empty
**Decision:** `defaultSessionFactory` passes `systemPromptOverride` only when the resolved system prompt is non-empty.
**Rationale:** Passing an override that returns `undefined` can yield an empty system prompt for chat sessions, which may contribute to poor behavior.
**Alternative considered:** Always pass the override. Rejected because it is unnecessary and potentially harmful.

## Risks / Trade-offs

- **[Risk]** Refactoring a large class can introduce regressions in edge cases (session reuse, tool state, compaction resume).
  → **Mitigation:** Keep the existing integration tests passing and add unit tests for each new service before changing the facade. Run the full Pi test suite after each service extraction.

- **[Risk]** `session.agent.waitForIdle()` may change behavior in future SDK versions.
  → **Mitigation:** The `RunDriver` interface localizes the SDK call. If the SDK changes, only `DefaultRunDriver` needs to change.

- **[Risk]** Splitting services increases file count and indirection.
  → **Mitigation:** Each service has a single, clearly named responsibility. The facade preserves the simple public API.

- **[Risk]** Background compaction resume logic is subtle and easy to break during extraction.
  → **Mitigation:** Move the existing logic into `PiCompactionCoordinator` as faithfully as possible, then add targeted tests for mid-turn and turn-boundary abort scenarios.

## Migration Plan

1. Create new service files with the extracted logic.
2. Update `PiEngine` to delegate to the services.
3. Add `createPiEngine()` factory and update `src/bun/index.ts`.
4. Update existing tests for constructor/factory changes.
5. Add unit tests for new services.
6. Run the full Pi test suite and API smoke tests.
7. Validate manually that the no-output regression is fixed.

Rollback: revert the commit(s) introducing the refactor. Because the public `ExecutionEngine` interface is unchanged, rollback only affects `src/bun/engine/pi/` and `src/bun/index.ts`.

## New Decisions from Test Exploration

### 9. Inject `MessageAppender` into `PiCompactionCoordinator`
**Decision:** `PiCompactionCoordinator` receives a narrow `MessageAppender` interface instead of calling `appendMessage(getDb(), ...)` directly.
**Rationale:** Removes the global database singleton dependency from the coordinator, making unit tests isolated and fast. Production wiring implements the interface with the existing `appendMessage(getDb(), ...)` call.

### 10. Import `translateEvent` directly in `PiExecutionController`
**Decision:** `PiExecutionController` imports `translateEvent` directly rather than receiving an `EventTranslator` dependency.
**Rationale:** `translateEvent` is a pure, side-effect-free function already covered by `pi-event-translator.test.ts`. Injecting it as an interface adds boilerplate without improving testability.

### 11. Inject `SessionPathResolver` into `PiSessionManager`
**Decision:** `PiSessionManager` receives a `SessionPathResolver` interface (`pathForConversation(conversationId): string`) via constructor injection.
**Rationale:** Disk-restore integration tests can inject a temp-path resolver, avoiding writes to `~/.railyin/pi-sessions/` and making tests hermetic.

### 12. Add faux-provider regression test for no-output bug
**Decision:** Add an integration test using `registerFauxProvider` that scripts an assistant response where final text deltas and `agent_end` arrive after `session.prompt()` resolves.
**Rationale:** Directly validates that the engine waits for `session.agent.waitForIdle()` before closing the stream, preventing regression of the no-output bug.

## Open Questions

- Should `PiExecutionController` call `session.agent.waitForIdle()` itself, or should `RunDriver` include it? (Decision: `RunDriver` includes it; the controller treats each driver call as a settled turn.)
- Should the `RunDriver` interface expose a way to inject raw-event forwarding? (Decision: no; raw events are handled by the controller's subscription and by the delegate tool implementation.)
