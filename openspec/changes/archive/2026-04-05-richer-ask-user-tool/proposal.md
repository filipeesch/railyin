## Why

The current `ask_me` tool accepts a single question, a selection mode (single/multi), and a flat list of option strings. This works for simple choices but falls short for more complex decision points: the model can't attach explanatory context to individual options, can't ask multiple related questions in one interaction, and can't present visual previews (e.g., two code snippets side-by-side) to help the user compare options. As a result, models either ask too many sequential single-item questions or bundle multiple concerns into one confusingly-worded question.

## What Changes

- Extend the `ask_me` tool schema to support: per-option descriptions, a recommended option flag, and multiple questions in a single call
- Expose a `preview` field on options for showing a markdown snippet alongside the option (useful for comparing code alternatives)
- Update the engine to handle the richer schema and transform it into the existing `ask_user_prompt` message format
- Update the UI widget to render descriptions beneath options, highlight recommended options, and show preview panes when present

## Capabilities

### New Capabilities

- `ask-user-option-metadata`: Per-option description and recommended flag in ask_user questions

### Modified Capabilities

- `ask-user-tool`: Tool schema extended with per-option `description`, `recommended` flag, and optional `preview` field; multi-question support added

## Impact

- `src/bun/workflow/tools.ts`: `ask_me` tool schema — add `description`, `recommended`, `preview` fields to option shape
- `src/bun/workflow/engine.ts`: tool call handler for `ask_me` — pass through new fields into the stored `ask_user_prompt` message
- `src/shared/rpc-types.ts`: `AskUserPromptContent` type — add new option fields
- `src/mainview/`: Ask prompt widget — render descriptions, recommended badge, preview pane
- No DB schema changes (stored as JSON content in conversation_messages)
- Backward compatible: all new fields are optional; existing messages continue to render
