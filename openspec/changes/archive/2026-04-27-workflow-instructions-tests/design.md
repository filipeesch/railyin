## Context

`workflow-instructions` introduces `getWorkflowTemplate()` and `buildSystemInstructions()` in `column-config.ts` and updates all four executor classes to call `buildSystemInstructions()` instead of reading `column?.stage_instructions` directly. The `systemInstructions` value flows through `ExecutionParamsBuilder.build()` into `ExecutionParams` and is ultimately consumed by each engine.

The existing test suite has:
- `column-config.test.ts`: covers `getColumnConfig()` only — no coverage of the new helpers
- `orchestrator.test.ts`: uses a `TestEngine` that discards params — no assertions on `systemInstructions`
- `copilot-rpc-scenarios.test.ts`: `MockCopilotSdkAdapter.trace.createCalls` captures the full `CopilotSdkSessionConfig` including `systemMessage` — can assert directly
- `claude-rpc-scenarios.test.ts`: `MockClaudeSdkAdapter.trace.createCalls` captures only `{ sessionId, model }` — **gap**

## Goals / Non-Goals

**Goals:**
- Unit test `getWorkflowTemplate()` and `buildSystemInstructions()` exhaustively (all merge cases, edge cases)
- Integration test the executor → engine propagation path using an in-memory DB + capturing engine
- Verify `systemInstructions` arrives correctly in both the Copilot and Claude engine paths
- Extend `MockClaudeSdkAdapter` trace to capture `systemInstructions` (follows existing Copilot mock pattern)

**Non-Goals:**
- Playwright/UI tests — no frontend surface
- Testing `resolvePrompt` (slash-prompt.test.ts already covers it exhaustively)
- Testing the executors in isolation (execution-params-builder.test.ts already covers `ExecutionParamsBuilder`)

## Decisions

### D1: Unit tests in `column-config.test.ts` — extend, don't create

The existing file already has the right test harness (`setupTestConfig`, `initDb`, board insertion). Adding tests here avoids a new file and keeps column-config concerns together.

**`getWorkflowTemplate()` cases:**
- Board found, template found → returns template object with correct `id`
- Board found, template found, `workflow_instructions` set → field is present
- Board found, template found, `workflow_instructions` absent → field is `undefined`
- Board not found → falls back to `"delivery"` template (mirrors existing `getColumnConfig` fallback)
- Board found, `workflow_template_id` unknown → returns `null`

**`buildSystemInstructions()` cases (pure merge logic):**
- Both set → `"workflow\n\nstage"`
- Only `workflow_instructions` → `"workflow"`
- Only `stage_instructions` → `"stage"` (regression guard for existing behaviour)
- Neither → `undefined` (NOT `""`)
- Either empty string → treated as absent (`.filter(Boolean)`)
- `columnId` not found → returns `workflow_instructions` alone (no crash)

### D2: Integration tests via `CapturingEngine` in `orchestrator.test.ts`

A small `CapturingEngine` class captures all `ExecutionParams` objects passed to `execute()`. The test workflow YAML is injected via `setupTestConfig`'s `extraWorkflows` parameter, which already exists and supports per-test workflow overrides.

```
CapturingEngine:
  capturedParams: ExecutionParams[] = []
  execute(params) → pushes params, yields { type:"done" }
```

Tests use a workflow with `workflow_instructions` set at template level and `stage_instructions` on one column but not another. They drive transitions via `orchestrator.executeTransition()` and `orchestrator.executeHumanTurn()` and assert `capturedParams[0].systemInstructions`.

**Key cases:**
- Transition into column with both set → merged value
- Transition into column with only `workflow_instructions` → workflow value only
- Transition into column with only `stage_instructions` → stage value only (regression)
- Transition into column with neither → `undefined`
- Human turn in column with both → same merged value
- Two boards using different templates → no cross-contamination

### D3: Copilot engine path — assert via existing trace

`MockCopilotSdkAdapter.trace.createCalls[n].config` already contains the full `CopilotSdkSessionConfig`. The `systemMessage` field (if present) contains the assembled system content including `systemInstructions`. Tests pass a known `systemInstructions` value into the engine and assert it appears in `config.systemMessage.content`.

**Cases:**
- `systemInstructions` set → appears in `systemMessage.content` (after task block)
- `systemInstructions` undefined → no `systemMessage` key in config

### D4: Claude engine path — extend `MockClaudeSdkAdapter` trace

Currently `trace.createCalls` only records `{ sessionId, model }`. Extend it to also capture `systemInstructions` from `ClaudeRunConfig`:

```ts
// Before
createCalls: Array<{ sessionId: string; model?: string }>

// After  
createCalls: Array<{ sessionId: string; model?: string; systemInstructions?: string }>
```

This is a one-line change to `claude-sdk-mock.ts` that mirrors the existing Copilot pattern. Tests then assert `trace.createCalls[0].systemInstructions` directly.

**Cases:**
- `systemInstructions` set → captured in trace
- `systemInstructions` undefined → field absent or `undefined` in trace

## Risks / Trade-offs

- **`CapturingEngine` duplication**: a simple capturing engine could be added to `helpers.ts` or as a local class. Local is fine for now given two test sites.
- **Mock change is test-only**: extending `MockClaudeSdkAdapter` is a test support change — no production risk, but must not break existing Claude scenario tests.
- **Workflow YAML fixture shape**: `setupTestConfig`'s `extraWorkflows` parameter accepts single-template YAML strings. The test workflow must follow that format exactly (id + columns, no array wrapper).
