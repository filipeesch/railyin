## Context

The orchestrator god-class was recently decomposed into focused executor classes (`TransitionExecutor`, `HumanTurnExecutor`, `RetryExecutor`, `CodeReviewExecutor`) backed by `ExecutionParamsBuilder` and `WorkingDirectoryResolver`. Column config lookup was extracted to `src/bun/workflow/column-config.ts` as a standalone `getColumnConfig()` function.

Currently `stage_instructions` is passed directly from `getColumnConfig()` to `paramsBuilder.build()` as `systemInstructions` in all four executor classes. There is no workflow-level equivalent. Additionally, slash references in `stage_instructions` are documented as pre-resolved but are never actually resolved — the resolution only happens for the `prompt` field inside each engine.

## Goals / Non-Goals

**Goals:**
- Add `workflow_instructions` to `WorkflowTemplateConfig` — a workflow-scoped system prompt that applies to every execution in every column.
- Merge `workflow_instructions` (first) + `stage_instructions` (second) into a single `systemInstructions` string before passing to `ExecutionParamsBuilder`.
- Delete the dead `src/bun/workflow/slash-prompt.ts` file.

**Non-Goals (explicitly out of scope):**
- Slash reference resolution for `workflow_instructions` or `stage_instructions` — both fields are inline text only. Slash resolution remains exclusively for `prompt` (handled per-engine).

**Non-Goals:**
- No new `ExecutionParams` fields — `systemInstructions: string | undefined` stays as-is.
- No DB schema changes.
- No frontend changes.
- No changes to `on_enter_prompt` resolution (already works correctly).

## Decisions

### D1: Merge happens in `column-config.ts`, not in each executor

`src/bun/workflow/column-config.ts` is the natural home. It already owns `getColumnConfig()` and the DB lookup for the workflow template. Two new exports:

```ts
// Returns the full WorkflowTemplateConfig for the board's assigned template.
export function getWorkflowTemplate(config: LoadedConfig, boardId: number): WorkflowTemplateConfig | null

// Merges workflow + stage instructions into a single string.
export function buildSystemInstructions(
  config: LoadedConfig,
  boardId: number,
  columnId: string,
): string | undefined
```

All four executors replace `column?.stage_instructions` with `buildSystemInstructions(config, boardId, columnId)`. This keeps executors free of merge logic and makes `column-config.ts` the single place to change if a third level is ever added.

**Alternative considered**: merge inside `ExecutionParamsBuilder.build()` — rejected because the builder is pure/dumb by design and should not know about workflow structure.

### D2: No slash resolution for `systemInstructions` — inline text only

`workflow_instructions` and `stage_instructions` are plain inline text fields. Slash reference resolution remains exclusively the responsibility of each engine for `prompt` — each engine has its own resolution path (CopilotEngine uses `resolvePrompt()`; ClaudeAdapter passes raw to the Claude SDK which resolves natively). `systemInstructions` is passed as-is from `buildSystemInstructions()` to the engine and used directly without further resolution.

**Alternative considered**: engine-level resolution for `systemInstructions` (mirroring `prompt`) — rejected due to complexity of two-field independent resolution before merge, and because the practical use cases (workflow-wide context, column persona) work fine with inline text.

### D3: Delete `src/bun/workflow/slash-prompt.ts`

This file has zero imports anywhere in the codebase. It implements a 2-path lookup resolver that is strictly less capable than `copilot-prompt-resolver.ts` (4 paths). Deleting it removes confusion and dead code. Its test file `src/bun/test/slash-prompt.test.ts` already imports from `copilot-prompt-resolver.ts` (not from `slash-prompt.ts`), so it survives.

## Risks / Trade-offs

- **Behaviour change for existing `stage_instructions` with slash refs** → These refs will no longer be silently passed as literal text to the engine — they were never resolved anyway. The behaviour is unchanged from current reality; the spec is now honest about it.
- **`buildSystemInstructions` hides the template lookup** → Minor indirection for executor authors, but the function name is clear and the module is the right owner.

## Migration Plan

1. Add `workflow_instructions?: string` to `WorkflowTemplateConfig` — purely additive, no existing YAML breaks.
2. Add helpers to `column-config.ts` and update all four executors — tested via existing `column-config.test.ts` (extend) and `execution-params-builder.test.ts`.
3. Fix slash resolution in both engines — low risk, covered by existing `slash-prompt.test.ts`.
4. Delete dead file.
5. Update YAML samples and `DEFAULT_DELIVERY_YAML`.

No rollback risk — all changes are additive or bug fixes. Existing configs without `workflow_instructions` behave identically.

## Open Questions

None — all design decisions resolved during exploration.
