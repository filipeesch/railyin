## Why

The `opencode-engine-support` change introduces a new execution engine with a novel server-lifecycle model, SSE event translation layer, and session-mapping strategy. Without a dedicated test suite, regressions in event translation, session continuity, config validation, and MCP context wiring would go undetected. This change adds the unit, integration, and lease-registry tests that verify the OpenCode engine's correctness in isolation and end-to-end through the orchestrator.

## What Changes

- Add `src/bun/test/opencode-events.test.ts` — unit tests for `event-translator.ts` (pure SSE Part → EngineEvent mapping)
- Add `src/bun/test/opencode-attachment-mapper.test.ts` — unit tests for `attachment-mapper.ts`
- Add `src/bun/test/opencode-config.test.ts` — config validation unit tests for `OpenCodeEngineConfig`
- Add `src/bun/test/support/opencode-sdk-mock.ts` — `MockOpenCodeSdkAdapter` and event builder helpers for integration tests
- Add `src/bun/test/opencode-rpc-scenarios.test.ts` — full integration test suite using `BackendRpcRuntime` + `MockOpenCodeSdkAdapter`, covering all shared RPC scenarios plus OpenCode-specific session lifecycle and context map cleanup
- Extend `src/bun/test/lease-registry.test.ts` — add a test proving the widened `engine: string` type accepts `"opencode"`

## Capabilities

### New Capabilities

- `opencode-engine-test-coverage`: Test coverage specification for the OpenCode engine — unit tests for event translation and attachment mapping, integration tests for RPC scenarios, session lifecycle, and config validation

### Modified Capabilities

- `engine-registry-behavior`: Add scenario proving that `"opencode"` is a valid engine type string accepted by `LeaseRegistry`

## Impact

- **New test files only** — no production code changes
- All tests run under the existing `bun test src/bun/test --timeout 20000` command
- No new test infrastructure needed — reuses `BackendRpcRuntime`, `shared-rpc-scenarios.ts`, and the existing mock adapter pattern
- `MockOpenCodeSdkAdapter` follows `MockClaudeSdkAdapter` pattern (adapter yields `EngineEvent` directly, translation is unit-tested separately)
