## 1. Extend column-config unit tests

- [x] 1.1 Add `getWorkflowTemplate()` tests to `src/bun/test/column-config.test.ts`: board found with known template returns correct object; board not found falls back to `"delivery"`; board with unknown `workflow_template_id` returns `null`; template with `workflow_instructions` set returns field correctly
- [x] 1.2 Add `buildSystemInstructions()` tests to `src/bun/test/column-config.test.ts`: both fields set returns `"W\n\nS"`; only `workflow_instructions` returns workflow string; only `stage_instructions` returns stage string (regression); neither returns `undefined` not `""`; empty string fields treated as absent; unknown `columnId` with `workflow_instructions` set returns workflow string without crash

## 2. Extend Claude SDK mock

- [x] 2.1 Extend `MockClaudeSdkAdapter.trace.createCalls` in `src/bun/test/support/claude-sdk-mock.ts` to capture `systemInstructions?: string` from `ClaudeRunConfig` (mirrors existing Copilot pattern); verify existing Claude scenario tests still pass

## 3. Integration tests — orchestrator + executors

- [x] 3.1 Add `CapturingEngine` class to `src/bun/test/orchestrator.test.ts` that records all `ExecutionParams` passed to `execute()`; it yields a single `{ type: "done" }` event
- [x] 3.2 Add a test workflow YAML fixture via `setupTestConfig` `extraWorkflows` with `workflow_instructions` set at template level, one column with `stage_instructions`, one column without
- [x] 3.3 Add transition executor test: task transitions into column with both fields → `capturedParams[0].systemInstructions` equals `"W\n\nS"`
- [x] 3.4 Add transition executor test: task transitions into column with only `workflow_instructions` → `systemInstructions` equals workflow string only
- [x] 3.5 Add transition executor test: workflow without `workflow_instructions`, column with `stage_instructions` → `systemInstructions` equals stage string (regression guard)
- [x] 3.6 Add transition executor test: neither field → `systemInstructions` is `undefined`
- [x] 3.7 Add human-turn executor test: `executeHumanTurn` in column with both fields → `systemInstructions` is merged string
- [x] 3.8 Add multi-board isolation test: two boards with different templates, only one has `workflow_instructions`; verify each board's executions receive only their own template's value

## 4. Engine-level tests — Copilot path

- [x] 4.1 Add test to `src/bun/test/copilot-rpc-scenarios.test.ts`: pass a known `systemInstructions` string into the engine via `ExecutionParams`; assert `MockCopilotSdkAdapter.trace.createCalls[0].config.systemMessage.content` contains that string
- [x] 4.2 Add test: `systemInstructions` is `undefined` → no `systemMessage` key in `createSession` config

## 5. Engine-level tests — Claude path

- [x] 5.1 Add test to `src/bun/test/claude-rpc-scenarios.test.ts`: pass a known `systemInstructions` string; assert `MockClaudeSdkAdapter.trace.createCalls[0].systemInstructions` equals that string
- [x] 5.2 Add test: `systemInstructions` undefined → `systemInstructions` is `undefined` in the trace entry

## 6. Full suite verification

- [x] 6.1 Run `bun test src/bun/test --timeout 20000` and confirm all tests pass (existing + new)
