## Why

The Cursor SDK engine implementation requires comprehensive test coverage to ensure correctness. The existing test infrastructure (`shared-rpc-scenarios.ts`, `backend-rpc-runtime.ts`) provides a solid foundation, but Cursor SDK's unique characteristics (gRPC-based SDK vs CLI-based Copilot) require specialized mocking patterns.

**Testing Challenges Unique to Cursor SDK:**
- Uses gRPC/Connect protocol (not STDIO like Copilot)
- Direct SDK integration via in-process API calls
- Agent-based execution with platform persistence
- Run.stream() returns AsyncGenerator<SDKMessage> for streaming

## What Changes

**Test Infrastructure Changes:**
- Create `src/bun/test/cursor/` directory with test files
- Add mock SDK adapter following AsyncGenerator pattern
- Create integration test file for Cursor SDK engine

**No Changes to Existing Test Infrastructure:**
- `shared-rpc-scenarios.ts` - No refactoring needed, works as-is
- `backend-rpc-runtime.ts` -通用 test harness works for all engines
- Existing test utilities preserved

## Capabilities

### New Capabilities
- `cursor-sdk-tests`: Test infrastructure for Cursor SDK engine with:
  - `src/bun/test/cursor/mocks.ts` - Mock SDK adapter with AsyncGenerator pattern
  - `src/bun/test/cursor/adapter.test.ts` - Unit tests for adapter
  - `src/bun/test/cursor/integration.test.ts` - Shared scenario tests
  - `e2e/ui/cursor.spec.ts` - Playwright UI tests

### Modified Capabilities
- `cursor-sdk` (existing spec): Test scenarios for Cursor SDK functionality

## Impact

**New Files Created:**
- `src/bun/test/cursor/mocks.ts` - Mock SDK adapter and test utilities
- `src/bun/test/cursor/adapter.test.ts` - Adapter unit tests
- `src/bun/test/cursor/integration.test.ts` - Integration tests
- `src/bun/test/support/cursor-sdk-mock.ts` - Mock SDK types (if needed)
- `e2e/ui/cursor.spec.ts` - Playwright UI tests

**No Breaking Changes:**
- Existing test infrastructure preserved
- No refactoring required in shared utilities
- Cursor tests follow existing patterns
