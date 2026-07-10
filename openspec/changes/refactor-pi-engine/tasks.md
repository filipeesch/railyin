## 1. Foundation Services

- [ ] 1.1 Create `src/bun/engine/pi/model-builder.ts` with `PiModelBuilder` and move `buildModel` logic from `engine.ts`.
- [ ] 1.2 Create `src/bun/engine/pi/dialect-resolver.ts` with `PiDialectResolver` and move slash-command/skill-path resolution from `engine.ts`.
- [ ] 1.3 Create `src/bun/engine/pi/tool-factory.ts` with `PiToolFactory` and move `buildAllTools`, harness context creation, and delegate tool implementation from `engine.ts`.
- [ ] 1.4 Create `src/bun/engine/pi/session-manager.ts` with `PiSessionManager` and move session creation, reuse, disposal, and `piSessionPathForConversation` from `engine.ts`. Inject a `SessionPathResolver` so tests can use temp paths.

## 2. Execution Abstractions

- [ ] 2.1 Create `src/bun/engine/pi/run-driver.ts` with the `RunDriver` interface and `DefaultRunDriver` implementation using `session.prompt()`, `session.agent.continue()`, and `session.agent.waitForIdle()`.
- [ ] 2.2 Create `src/bun/engine/pi/compaction-coordinator.ts` with `PiCompactionCoordinator` and move background compaction threshold logic, `bgCompactions` map, and resume decision from `engine.ts`. Inject a `MessageAppender` for testability.
- [ ] 2.3 Create `src/bun/engine/pi/execution-controller.ts` with `PiExecutionController` owning the `AsyncQueue`, event subscription/translation, and the prompt/continue loop driven by `RunDriver`.

## 3. Facade and Factory

- [ ] 3.1 Refactor `src/bun/engine/pi/engine.ts` into a thin `PiEngine` facade that delegates to the new services and implements `ExecutionEngine`.
- [ ] 3.2 Create `src/bun/engine/pi/pi-engine-factory.ts` with `createPiEngine()` for production wiring.
- [ ] 3.3 Update `src/bun/index.ts` to use `createPiEngine()` when registering the Pi engine.

## 4. Regression Fixes and Cleanup

- [ ] 4.1 Fix the no-output regression by ensuring `DefaultRunDriver` awaits `session.agent.waitForIdle()` after each prompt/continue.
- [ ] 4.2 Fix the empty-system-prompt issue by only passing `systemPromptOverride` when the resolved system prompt is non-empty.
- [ ] 4.3 Remove `buildCompactionSettings()` from `engine.ts` and delete the test that asserts it.
- [ ] 4.4 Remove commented-out `delegateEmitRefs` code from `engine.ts`.

## 5. Tests

- [ ] 5.1 Update existing `PiEngine` tests for the new constructor/factory wiring.
- [ ] 5.2 Add unit tests for `PiExecutionController` using a mock `RunDriver` and fake SDK event source.
- [ ] 5.3 Add unit tests for `PiCompactionCoordinator` covering threshold, slot acquisition, mid-turn vs turn-boundary resume, and double-trigger prevention.
- [ ] 5.4 Add unit tests for `DefaultRunDriver` verifying prompt/continue/waitForIdle ordering and abort handling.
- [ ] 5.5 Add unit tests for `PiSessionManager` covering creation, reuse, disposal, and disk restore.
- [ ] 5.6 Run the full Pi test suite (`bun test src/bun/test/pi --timeout 20000`) and ensure all tests pass.
- [ ] 5.7 Run API smoke tests (`bun test e2e/api --timeout 30000`).
