## MODIFIED Requirements

### Requirement: Conversation supports distinct message types
The system SHALL support the following message types in a conversation: `user`, `assistant`, `system`, `tool_call`, `tool_result`, `transition_event`, `file_diff`, `ask_user_prompt`, `reasoning`, `compaction_summary`, `code_review`. The `conversations` table SHALL store `model_params JSON NULL` to persist per-conversation model parameter overrides as a `[{id, value}]` array. The previous `reasoning_mode_override TEXT` column is removed.

#### Scenario: Conversation stores model_params when user selects a setting
- **WHEN** the user selects a model setting value (e.g., effort "high")
- **THEN** `conversations.model_params` is updated to `[{"id":"effort","value":"high"}]`

#### Scenario: Conversation model_params is null by default
- **WHEN** a new conversation is created
- **THEN** `conversations.model_params` is `null`
- **AND** the engine applies no parameter override

#### Scenario: Existing reasoning_mode_override values are migrated to model_params
- **WHEN** the migration runs on a database with non-null `reasoning_mode_override` rows
- **THEN** each non-null value `v` is migrated to `model_params = [{"id":"effort","value":"v"}]`
- **AND** the `reasoning_mode_override` column is removed
