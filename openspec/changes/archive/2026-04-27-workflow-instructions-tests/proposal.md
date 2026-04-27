## Why

The `workflow-instructions` change adds a new `workflow_instructions` field to `WorkflowTemplateConfig` and introduces `getWorkflowTemplate()` and `buildSystemInstructions()` helpers in `column-config.ts`. This implementation has no dedicated test coverage beyond a passing build. The existing test suite has zero assertions on how `systemInstructions` is assembled and propagated — a regression could go undetected.

This change adds a focused test suite that covers the full `systemInstructions` assembly chain: from the `buildSystemInstructions()` merge logic through executor propagation to engine delivery, plus integration coverage for multi-board isolation and the cross-executor consistency guarantee.

## What Changes

- Extends `src/bun/test/column-config.test.ts` with unit tests for `getWorkflowTemplate()` and `buildSystemInstructions()`
- Adds integration tests to `src/bun/test/orchestrator.test.ts` using a capturing test engine to assert `systemInstructions` values flowing through all four executors
- Extends `src/bun/test/copilot-rpc-scenarios.test.ts` to assert `systemInstructions` arrives in the Copilot SDK `createSession` config
- Extends `src/bun/test/claude-rpc-scenarios.test.ts` to assert `systemInstructions` arrives in `ClaudeRunConfig`
- Extends `MockClaudeSdkAdapter` in `src/bun/test/support/claude-sdk-mock.ts` to capture `systemInstructions` in its trace

## Capabilities

### New Capabilities
- `workflow-instructions-test-coverage`: Unit, integration, and engine-level tests for the systemInstructions assembly chain

## Impact

- Test files only — no production code changes
- `src/bun/test/support/claude-sdk-mock.ts`: trace type extended (test support code)
