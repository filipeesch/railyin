## Why

The `fix-pi-ghost-tools` change corrects two Pi engine bugs: (1) SDK built-in tools disappearing on session reuse, and (2) a ghost `search_text` reference in `run_command`'s description. Without tests, these regressions are invisible until a user reports them again.

This companion change adds targeted test coverage that would have caught both bugs before release, and will prevent them from silently re-emerging.

## What Changes

- **New `conversation-context.test.ts`**: Asserts that `MICRO_COMPACT_CLEARABLE_TOOLS` and `TOOL_RESULT_LIMITS` contain no stale tool names (`search_text`, `find_files`)
- **Extend `tool-registry.test.ts`**: Assert that `run_command` description contains no reference to `search_text` and that it references `grep`/`find` instead
- **Extend `pi-engine.test.ts`**: Add session reuse scenarios — assert `setActiveToolsByName()` is called (not `agent.state.tools` assignment) and that SDK built-in names survive turn 2+; assert `commonCtxRefs` map lifecycle (create on first turn, mutate in-place on reuse)
- **Extend `pi-event-translator.test.ts`**: Add `buildPiToolDisplay` cases asserting no explicit `search_text` branch exists (falls to default), and that `grep`/`find`/`ls`/`read` produce correct display metadata
- **Refactoring enabling testability**: Extract a `protected createNewSession()` method from `getOrCreateSession()` so that `TestPiEngine` can inject mocked sessions while still exercising the real session reuse path — aligning with the Dependency Inversion Principle

## Capabilities

### New Capabilities

*(none — test-only companion change)*

### Modified Capabilities

*(none — no production spec requirements are changing; all changes are in test files)*

## Impact

- **`src/bun/engine/pi/engine.ts`**: Extract `protected createNewSession(tools, systemPrompt, workingDir)` — a testability refactoring, no behavioural change
- **`src/bun/test/pi-engine.test.ts`**: New `PE-SESSION-REUSE-*` scenarios; `MockAgentSession` grows `setActiveToolsByName` spy
- **`src/bun/test/tool-registry.test.ts`**: New assertion for `run_command` description content
- **`src/bun/test/pi-event-translator.test.ts`**: New `buildPiToolDisplay` assertions
- **`src/bun/test/conversation-context.test.ts`**: New file asserting constant contents
- No API surface changes, no DB migrations, no config changes
