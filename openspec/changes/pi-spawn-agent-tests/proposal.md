## Why

The `pi-engine-spawn-agent` change introduces several new components (`AgentResolver`, `SpawnTool`, `SpawnConfig`, built-in agent files, and `EngineEvent` type extensions) with complex behavioral contracts that have no existing test coverage. Without a dedicated test suite, silent regressions in agent resolution, concurrency caps, event forwarding, recursion guards, and UI streaming will go undetected.

## What Changes

- **New unit test file**: `src/bun/test/pi-agent-resolver.test.ts` — 15 scenarios covering the three-tier resolution chain (project → user → built-in), frontmatter parsing, fallback behavior, and error cases
- **New unit test file**: `src/bun/test/pi-spawn-tool.test.ts` — 22 scenarios covering named agent invocation, anonymous spawn, parallel execution, concurrency cap, recursion guard, MAX_CHILDREN limit, event forwarding, token streaming, cancel propagation, and result extraction
- **New unit test file**: `src/bun/test/pi-build-all-tools.test.ts` — 5 scenarios verifying `buildAllTools` only adds `spawn_agent` when `SpawnConfig` is present (absence = children can't spawn)
- **New unit test file**: `src/bun/test/pi-engine-cancel.test.ts` — 4 scenarios for the `PiEngine.cancel()` bug fix (currently aborts all sessions; must target only the correct execution's agent)
- **New unit test file**: `src/bun/test/pi-engine-session-cleanup.test.ts` — 3 scenarios verifying `sessions` / `harnessContexts` maps are evicted on task archive/delete
- **New Playwright spec**: `e2e/ui/spawn-agent-stream.spec.ts` — 5 scenarios verifying child token nesting under spawn_agent card, tool_call blocks inside spawn_agent card, reload parity (live vs persisted structure), and concurrent child streams
- **New support file**: `src/bun/test/support/fake-agent.ts` — `FakeAgent` test double implementing the Pi `Agent` public interface (subscribe, prompt, waitForIdle, abort, state)

## Capabilities

### New Capabilities

- `pi-agent-resolver-tests`: Unit test coverage for `AgentResolver` — resolution chain, frontmatter parsing, override precedence, file-not-found errors
- `pi-spawn-tool-tests`: Unit test coverage for `SpawnTool` — named/anonymous invocation, parallel execution, concurrency, event forwarding, token nesting, recursion guard
- `pi-spawn-infra-tests`: Tests for `buildAllTools` gating, `PiEngine.cancel()` fix, and session lifecycle cleanup
- `pi-spawn-ui-tests`: Playwright scenarios for live child token streaming nested under spawn_agent card in the UI

### Modified Capabilities

- `pi-spawn-agent`: Add testability requirement — `AgentResolver` MUST accept injected `basePaths` array for testing without real filesystem structure; `SpawnTool` MUST accept `agentFactory` from `SpawnConfig` (already decided in design)

## Impact

- **New test files**: `src/bun/test/pi-agent-resolver.test.ts`, `src/bun/test/pi-spawn-tool.test.ts`, `src/bun/test/pi-build-all-tools.test.ts`, `src/bun/test/pi-engine-cancel.test.ts`, `src/bun/test/pi-engine-session-cleanup.test.ts`
- **New support file**: `src/bun/test/support/fake-agent.ts`
- **New Playwright spec**: `e2e/ui/spawn-agent-stream.spec.ts`
- **No production code changes** — all DI seams (agentFactory, injected basePaths) are already required by the spawn-agent design
- **No new test dependencies** — reuses Bun test runner, existing tmpdir helpers, Playwright infrastructure already in the repo
