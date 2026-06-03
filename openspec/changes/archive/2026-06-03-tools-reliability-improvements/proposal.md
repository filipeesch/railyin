## Why

Local LLMs (vLLM, LM Studio, Ollama) frequently misuse three tool surfaces — embedding decision options in question text, sending wrong skill names, and hallucinating board IDs — causing avoidable failure loops that break the agent's task execution. These are reliability papercuts that compound on every Pi engine session with a local model.

## What Changes

- **`decision_request` validation**: Add `minItems: 2` to the `options` array in the JSON Schema for `exclusive`/`non_exclusive` questions, add runtime post-validation in `executeCommonTool` that checks options count per question type, and tighten the tool description to explicitly forbid embedding options in question text (remove duplication between top-level description and field descriptions).
- **`skill` tool error recovery**: Extend the `SkillResolver` interface with a `list(): Promise<string[]>` method; implement it in `FileSystemSkillResolver` by scanning configured directories for subdirectories containing `SKILL.md`; rewrite the "not found" error to list all available skill names and suggest the closest match via case-insensitive comparison.
- **Board tool `board_id` removal**: Remove the `board_id` parameter from the JSON Schema of `get_board_summary`, `list_tasks`, and `create_task`. The executor already falls back to `ctx.boardId` — removing the schema field prevents local LLMs from hallucinating wrong values while keeping full functionality for sessions running inside a task context.

## Capabilities

### New Capabilities

- `skill-resolver-listing`: The `SkillResolver` interface gains a `list()` method that returns all discoverable skill names; `FileSystemSkillResolver` implements it by scanning configured directories.

### Modified Capabilities

- `engine-tool-input-validation`: The `decision_request` tool gets schema-level (`minItems: 2` on options) and runtime-level (type-aware options count check) validation on top of the existing AJV validation layer.
- `board-tool-executor`: The `get_board_summary`, `list_tasks`, and `create_task` tool schemas no longer expose `board_id` as a parameter; context-based fallback remains the sole resolution path.
- `pi-native-tools`: The `skill` tool error response now lists all available skills and fuzzy-hints the closest match.

## Impact

- `src/bun/engine/decision-request-tool-definition.ts` — schema + description changes
- `src/bun/engine/common-tools.ts` — runtime validation in `executeCommonTool`
- `src/bun/engine/pi/skill-resolver.ts` — new `list()` method on interface and `FileSystemSkillResolver`
- `src/bun/engine/pi/tools/skill.ts` — enriched error message
- `src/bun/workflow/tools/registry.ts` — remove `board_id` from three tool schemas
- Existing test files for each touched area will need new cases (tracked separately)
