## Why

The `pi-engine-local-llm-harness` change introduces novel, Pi-specific components (`ContentHashCache`, `UndoStack`, `PiSessionManager`, `EventTranslator`, Pi tools) with complex behavioral contracts — chained undo, hash-keyed deduplication, compaction boundary resets, search cache glob invalidation — that are invisible to the existing Copilot/Claude test coverage. Without a dedicated test suite, regressions in these contracts will be silent.

## What Changes

- **New unit test files** for pure-logic components (no I/O): `ContentHashCache`, `UndoStack`
- **New filesystem integration tests** (real tmpdir): all Pi harness tools (read_file, glob, write_file, patch_file, delete_file, rename_file, undo_write, search_text, run_command, fetch_url, search_internet)
- **New engine integration test file**: `MockPiSdkAdapter` + `BackendRpcRuntime` to exercise `PiEngine` end-to-end with in-memory DB (follows Copilot/Claude RPC scenario pattern)
- **New support file**: `src/bun/test/support/pi-sdk-mock.ts` — scripted `AgentSession` event emitter (mirrors `claude-sdk-mock.ts` / `copilot-sdk-mock.ts` patterns)
- **Extended Playwright specs**: 3 new scenarios in `tool-rendering.spec.ts` for `undo_write` result display, `op:XXXX` in tool result, `[unchanged]` tool result rendering
- **Pi-specific RPC scenarios**: 3 new scenarios in `pi-rpc-scenarios.test.ts` that call the same `shared-rpc-scenarios.ts` functions plus Pi-only flows

## Capabilities

### New Capabilities
- `pi-hash-cache-tests`: Unit scenarios for `ContentHashCache` — first read, dedup, change detection, write invalidation, compaction reset, search caching, glob invalidation via picomatch
- `pi-undo-stack-tests`: Unit scenarios for `UndoStack` — push, peel-by-path (chained), stack overflow eviction, snapshot pre-patch content
- `pi-file-tools-tests`: Filesystem integration tests for all file/glob/search/shell tools in the Pi harness with real tmpdir
- `pi-engine-rpc-tests`: End-to-end engine integration tests via `BackendRpcRuntime` + `MockPiSdkAdapter`; re-uses shared RPC scenarios + Pi-specific flows
- `pi-playwright-tests`: Playwright UI scenario extensions for Pi-specific tool result rendering

### Modified Capabilities
- `pi-tool-harness`: Add testability requirement — `buildPiTools` MUST accept injected `HarnessContext` and filesystem adapter so unit tests can substitute real I/O. No behavior change.

## Impact

- **New files**: `src/bun/test/pi-hash-cache.test.ts`, `src/bun/test/pi-undo-stack.test.ts`, `src/bun/test/pi-file-tools.test.ts`, `src/bun/test/pi-search-tools.test.ts`, `src/bun/test/pi-shell-tool.test.ts`, `src/bun/test/pi-events.test.ts`, `src/bun/test/pi-session-manager.test.ts`, `src/bun/test/pi-tool-groups.test.ts`, `src/bun/test/pi-rpc-scenarios.test.ts`
- **New support file**: `src/bun/test/support/pi-sdk-mock.ts`
- **New Playwright scenarios**: 3 scenarios appended to `e2e/ui/tool-rendering.spec.ts`
- **No production code changes** — all DI seams for testability are already required by the harness design (HarnessContext injected, PiSdkAdapter interface)
- **No new test dependencies** — reuses Bun test runner, existing tmpdir helpers, `BackendRpcRuntime`, Playwright already in the repo
