## Why

When the AI model needs clarification before proceeding, it currently has no structured way to ask — it either embeds a question in prose (which the user may miss) or misuses existing tools like `run_command echo`. This creates a broken interaction loop. Additionally, the tool set available to the model is currently all-or-nothing; there is no way to configure which tools are appropriate for a given workflow column.

## What Changes

- **New `ask_user` tool** the model can call to request structured user input with a question, radio/checkbox options, and a mandatory "Other" free-text fallback.
- **Engine intercepts `ask_user`** instead of executing it — suspends execution, saves the question+options to the conversation, and transitions to `waiting_user` execution state.
- **Chat widget** renders the `ask_user` call as a structured UI element (radio buttons or checkboxes + "Other" text input) instead of a plain text bubble.
- **Per-column `tools` config** in workflow YAML — each column declares which tools the model may call. Columns without a `tools` key fall back to the current default set (`read_file`, `list_dir`, `run_command`). `ask_user` is only offered when the column explicitly includes it.
- **`waiting_user` state handling** — card badge, drawer state label, and chat input remain active; the Retry button is hidden for this state.
- **`handleHumanTurn` resumes from `waiting_user`** — when the user submits their answer (either a selected option or free text), it feeds back into the conversation as a regular user message and the model continues.

## Capabilities

### New Capabilities

- `ask-user-tool`: The `ask_user` tool definition, engine interception logic, `waiting_user` state transitions, and the chat widget that renders structured answer UI.
- `column-tool-config`: Per-column `tools` array in workflow YAML, config type update, and engine filtering of tool definitions based on column config.

### Modified Capabilities

- `workflow-engine`: Execution loop must intercept `ask_user` calls and handle `waiting_user` transition. Column tool filtering changes how `TOOL_DEFINITIONS` are assembled per execution.
- `conversation`: New `ask_user_prompt` message type to store the question + options for UI rendering after the fact (e.g. drawer reload).

## Impact

- `src/bun/workflow/tools.ts` — add `ask_user` tool definition
- `src/bun/workflow/engine.ts` — intercept `ask_user` in tool loop; filter tools by column config
- `src/bun/config/index.ts` — add `tools?: string[]` to `WorkflowColumnConfig`
- `config/workflows/*.yaml` — updated delivery template with `tools:` examples
- `src/mainview/components/MessageBubble.vue` — render `ask_user_prompt` type as structured widget
- `src/mainview/components/TaskCard.vue` — badge label + color for `waiting_user`
- `src/mainview/components/TaskDetailDrawer.vue` — hide Retry for `waiting_user`, show appropriate label
- `src/shared/rpc-types.ts` — add `ask_user_prompt` to conversation message types
