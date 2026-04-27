## Why

`executeCommonTool` has zero input validation beyond a JSON parse check. When a model sends an invented enum value (e.g. `"single_choice"` instead of `"exclusive"`), it either gets a cryptic runtime crash or silently incorrect behaviour. The ad-hoc validation added for `interview_me` is a band-aid; a generic, schema-driven gate would cover all current and future tools automatically.

## What Changes

- **NEW**: `validateToolArgs(def, args)` helper — driven by `AIToolDefinition.parameters` JSON Schema, returns a descriptive error string or `null`. Uses AJV for validation, formats errors in model-friendly language.
- **NEW**: AJV validation gate at the top of `executeCommonTool` — replaces the `interview_me` ad-hoc block and covers all tools.
- **REMOVED**: `toToolArgs()` from `engine/claude/tools.ts` and `engine/copilot/tools.ts` — these functions stringify typed JSON args before passing them to `executeCommonTool`, forcing every handler to re-parse. Eliminated; raw `Record<string, unknown>` is passed directly.
- **CHANGED**: `AIToolDefinition.parameters` typed as `JSONSchema7` (from `@types/json-schema`) instead of a narrow custom type.
- **CHANGED**: All tool handler signatures in `common-tools.ts`, `workflow/tools/board-tools.ts`, and `workflow/tools/lsp-tools.ts` widened from `Record<string, string>` to `Record<string, unknown>`.
- **CHANGED**: `update_todo_status.status` schema adds an explicit `enum` (`pending`, `in-progress`, `done`, `blocked`, `deleted`) — makes the field self-documenting and enables enum validation.
- **CHANGED**: `interview_me.questions` schema adds `minItems: 1` — replaces the previous ad-hoc runtime check for empty arrays with a schema constraint.
- **CHANGED**: `reorganize_todos.items` handler drops the `JSON.parse` fallback — after `toToolArgs()` is removed, items arrive as a native array.
- **FIXED**: Duplicate code block in `engine/claude/tools.ts` (lines 157–306 are byte-for-byte identical to lines 1–154) — duplicate removed.
- **DEPENDENCY**: `ajv` added as a direct runtime dependency (already transitive via `@modelcontextprotocol/sdk`). `@types/json-schema` added as a dev dependency.

## Capabilities

### New Capabilities

- `engine-tool-input-validation`: Schema-driven validation of all common tool inputs at the `executeCommonTool` entry point, returning clear error messages to the model on invalid enum values, missing required fields, or type mismatches.

### Modified Capabilities

- `engine-common-tools`: Handler signatures change from `Record<string, string>` to `Record<string, unknown>`; `executeCommonTool` gains a generic validation gate; `update_todo_status.status` gets an enum constraint.
- `engine-interview-common-tool`: The ad-hoc `interview_me` type-normalisation block is replaced by the generic AJV validator.

## Impact

- `src/bun/engine/common-tools.ts` — validation gate, signature change, schema enum addition
- `src/bun/engine/validate-tool-args.ts` — **new file**
- `src/bun/engine/claude/tools.ts` — remove `toToolArgs()` and duplicate block
- `src/bun/engine/copilot/tools.ts` — remove `toToolArgs()`
- `src/bun/ai/types.ts` — `AIToolDefinition.parameters` typed as `JSONSchema7`
- `src/bun/workflow/tools/board-tools.ts` — handler signatures widened
- `src/bun/workflow/tools/lsp-tools.ts` — handler signatures widened
- `src/bun/test/tasks-tools.test.ts`, `claude-tools.test.ts`, `common-tools-registration.test.ts` — test args updated from string-typed to proper types
- `package.json` — `ajv` (dep), `@types/json-schema` (devDep)
