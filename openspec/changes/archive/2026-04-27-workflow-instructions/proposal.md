## Why

`stage_instructions` lets authors inject persistent system-prompt text scoped to a single column. There is no equivalent at the workflow level, so instructions that apply across all columns (e.g. "you are working in the Delivery workflow — prefer small commits") must be duplicated into every column. A `workflow_instructions` field on the workflow template solves this with a single declaration.

## What Changes

- Add `workflow_instructions?: string` to `WorkflowTemplateConfig` in `src/bun/config/index.ts`.
- Add `getWorkflowTemplate()` helper to `src/bun/workflow/column-config.ts` (returns the full template for a board).
- Add `buildSystemInstructions()` helper to `src/bun/workflow/column-config.ts` that merges `[workflow_instructions, stage_instructions].filter(Boolean).join("\n\n")`.
- Replace all direct `column?.stage_instructions` reads in the four executor classes with `buildSystemInstructions()`.
- Fix the pre-existing slash-resolution gap: resolve `systemInstructions` inside each engine (CopilotEngine, ClaudeAdapter) using the same `resolvePrompt()` already used for the prompt — so `/prompt-name` references work in both `workflow_instructions` and `stage_instructions`.
- **Delete** `src/bun/workflow/slash-prompt.ts` — it is dead code (zero imports).
- Update `config/workflows/delivery.yaml` and `DEFAULT_DELIVERY_YAML` in config to show the new field.

## Capabilities

### New Capabilities
- `workflow-instructions`: Workflow-level system instructions that apply to every execution across all columns in a workflow, merged before per-column `stage_instructions`.

### Modified Capabilities
- `workflow-engine`: `stage_instructions` slash-reference resolution was documented as resolved but never actually happened; this change fixes the resolution in both engines and extends the same behaviour to `workflow_instructions`.

## Impact

- **Config types** (`src/bun/config/index.ts`): new optional field on `WorkflowTemplateConfig`.
- **workflow/column-config.ts**: two new exported helpers used by all four executor classes.
- **Executor classes** (4 files in `src/bun/engine/execution/`): one-line change each.
- **CopilotEngine** (`src/bun/engine/copilot/engine.ts`): add one `resolvePrompt` call.
- **ClaudeAdapter** (`src/bun/engine/claude/adapter.ts`): add one `resolvePrompt` call.
- **Dead code removed**: `src/bun/workflow/slash-prompt.ts`.
- No DB migration required — purely config/runtime.
- No API or frontend changes.
