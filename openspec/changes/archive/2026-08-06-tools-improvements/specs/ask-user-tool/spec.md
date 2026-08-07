## REMOVED Requirements

### Requirement: Model can call ask_user to request structured input
**Reason**: The `ask_me` tool definition is removed from the tool registry (`TOOL_DEFINITIONS`, `TOOL_GROUPS`, `TOOL_DESCRIPTIONS`). The tool is no longer offered to models. The `ask_user_prompt` message type and `AskUserPrompt.vue` component remain ONLY for `shell_approval` compatibility. Interactive question asking is now handled exclusively by `decision_request` with its "Record as decisions" toggle.
**Migration**: Models should use `decision_request` for all interactive questioning. Native engine elicitation (Claude `onElicitation`, Copilot `session.ask_user`) remains available at the SDK level, and `ask_user_prompt` continues to render for shell approval events.
