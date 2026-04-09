## Why

The Copilot engine path still lacks a reliable backend-level validation layer that exercises real RPC flows, real orchestrator persistence, and real engine logic without depending on UI automation or live SDK credentials. We need this now because engine integrations are expanding, and future backends such as Claude Code should be able to reuse the same scenario suite instead of spawning one-off test harnesses per engine.

## What Changes

- Add a reusable backend RPC scenario test capability that drives task RPC handlers and verifies callback emissions, database persistence, multi-turn chat flows, tool calls, interactive pauses, and cancellation.
- Introduce engine-specific SDK mock adapters so tests can instantiate the real Copilot engine with mocked Copilot SDK classes, and later instantiate other engines such as Claude Code with their own SDK mocks.
- Refactor the RPC/coordinator seam so scenario tests can inject a coordinator implementation dynamically while preserving the existing production orchestrator behavior.
- Define consistent non-native cancellation semantics so backend scenario assertions remain stable across engine implementations.

## Capabilities

### New Capabilities
- `engine-integration-testing`: Reusable backend RPC scenario harnesses, engine SDK mocks, callback recorders, and persistence assertions for pluggable execution backends.

### Modified Capabilities
- `copilot-engine`: The engine must support testable SDK injection and verified session behaviors such as resume, create fallback, streaming, tool execution, cancellation, and model listing.
- `execution-engine`: The coordinator/orchestrator boundary must support dynamic injection in tests and define stable cross-engine execution and cancellation semantics.

## Impact

- Affected code: `src/bun/handlers/tasks.ts`, `src/bun/engine/orchestrator.ts`, `src/bun/engine/copilot/*`, test harness utilities under `src/bun/test` or a new engine-test support area, and future engine implementations.
- Affected systems: backend RPC handling, execution persistence, engine session lifecycle, and automated test infrastructure.
- Dependencies: mocked SDK adapter layers for Copilot now and additional pluggable engine SDKs later.
