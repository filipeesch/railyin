## 1. Column Tool Configuration

- [x] 1.1 Add `tools?: string[]` to `WorkflowColumnConfig` interface in `src/bun/config/index.ts`
- [x] 1.2 Update `getColumnConfig` / engine to filter `TOOL_DEFINITIONS` by column `tools` array when present, falling back to defaults when absent
- [x] 1.3 Log warning at config load time for unknown tool names in a column's `tools` list
- [x] 1.4 Update `config/workflows/delivery.yaml` with commented `tools:` example on relevant columns

## 2. ask_user Tool Definition

- [x] 2.1 Add `ask_user` to `TOOL_DEFINITIONS` in `src/bun/workflow/tools.ts` with `question` (string), `selection_mode` ("single" | "multi"), and `options` (string[]) parameters
- [x] 2.2 Add `ask_user_prompt` to the `ConversationMessageType` union in `src/shared/rpc-types.ts`

## 3. Engine Interception

- [x] 3.1 In the tool loop in `src/bun/workflow/engine.ts`, detect `ask_user` calls before dispatching to `executeTool`
- [x] 3.2 On `ask_user` detection: append an `ask_user_prompt` conversation message with JSON content `{ question, selection_mode, options }`
- [x] 3.3 Set `execution_state = 'waiting_user'` and `execution status = 'waiting_user'`, then exit the tool loop and `runExecution` early
- [x] 3.4 Push `task.updated` to frontend via `onTaskUpdated` after setting `waiting_user`

## 4. Frontend — Card and Drawer State

- [x] 4.1 Add `waiting_user` label ("Waiting for input") and badge color (warning/orange) to `TaskCard.vue`
- [x] 4.2 Add `waiting_user` label to the status display in `TaskDetailDrawer.vue`
- [x] 4.3 Hide the Retry button in `TaskDetailDrawer.vue` when `execution_state === 'waiting_user'` (keep only chat input)
- [x] 4.4 Ensure chat input and send button are enabled when `execution_state === 'waiting_user'`

## 5. Chat Widget — AskUserPrompt

- [x] 5.1 Create `AskUserPrompt.vue` component that accepts `{ question, selection_mode, options }` props and renders radio buttons (single) or checkboxes (multi) plus an "Other (specify)" option with text input
- [x] 5.2 Emit a `submit` event from `AskUserPrompt.vue` with the composed answer string when the user clicks Submit
- [x] 5.3 In `MessageBubble.vue`, detect `type === 'ask_user_prompt'` and render `AskUserPrompt` instead of the default text bubble
- [x] 5.4 Parse the message `content` JSON to extract `question`, `selection_mode`, `options` for the component
- [x] 5.5 Determine answered/unanswered state: if a `user` message exists in the conversation after this `ask_user_prompt`, render the widget as read-only with the answer shown
- [x] 5.6 When user submits via `AskUserPrompt`, call the existing `tasks.sendMessage` IPC handler with the answer text

## 6. Testing

- [x] 6.1 Add engine test: `ask_user` tool call in tool loop sets `execution_state = 'waiting_user'` and writes `ask_user_prompt` message (using FakeAI returning an `ask_user` tool call)
- [x] 6.2 Add engine test: column with `tools: [read_file]` sends only `read_file` definition to provider
- [x] 6.3 Add engine test: column without `tools` key sends default tool set
- [x] 6.4 Add `FakeAIProvider` variant that returns a scripted `ask_user` tool call for use in tests
