## 1. Schema: Tool Definition and RPC Types

- [x] 1.1 Update `ask_me` tool schema in `src/bun/workflow/tools.ts`: change `options` from `string[]` to object array with `label` (required), `description` (optional string), `recommended` (optional boolean), `preview` (optional string); change top-level to accept `questions` array
- [x] 1.2 Update `AskUserPromptContent` type in `src/shared/rpc-types.ts` to include the new option fields and `questions` array structure
- [x] 1.3 Update the tool's description string in `tools.ts` to mention when to use `description`, `recommended`, and `preview` fields

## 2. Engine: Pass-Through New Fields

- [x] 2.1 In `engine.ts`, update the `ask_me` tool call handler to map the new question/option shape (including all new fields) into the stored `ask_user_prompt` message content JSON
- [x] 2.2 Ensure backward compatibility: if the incoming tool call still uses the legacy flat schema (top-level `question` string + `options` string array), normalize it to the new `questions` array format before storing

## 3. UI: Render New Option Metadata

- [x] 3.1 Update the ask user prompt widget to render `description` text below each option label when present
- [x] 3.2 Update the widget to show a "Recommended" badge on options with `recommended: true`
- [x] 3.3 Update the widget to support multi-question rendering: iterate `questions` array and render each as a stacked section
- [x] 3.4 Add preview pane: when any option in a question has a `preview` field, render a markdown preview pane that updates to show the preview of the currently selected/focused option
- [x] 3.5 Ensure preview pane is absent (no layout shift) when no options have preview content

## 4. Tests

- [x] 4.1 Unit test: engine correctly normalizes legacy flat schema to `questions` array format
- [x] 4.2 Unit test: engine passes through `description`, `recommended`, `preview` fields into stored message
- [x] 4.3 Component test (or snapshot): widget renders description text below option label
- [x] 4.4 Component test: recommended option displays badge
- [x] 4.5 Component test: preview pane renders when options have preview; absent when they don't
