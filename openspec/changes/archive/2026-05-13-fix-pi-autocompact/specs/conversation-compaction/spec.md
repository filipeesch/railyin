## MODIFIED Requirements

### Requirement: Compaction uses the task's own model
The system SHALL ensure that when `compact()` is called on the Pi engine, the session is restored (or reused) with the model that was originally used for the conversation. The model SHALL be read from the `conversations.model` DB column. The context window for the compaction session SHALL be resolved from `ModelSettingsRepository` using the conversation's stored model and the engine's `workspaceKey`. If `conversations.model` is NULL (no model stored), the engine SHALL throw — the primary defense is the UI-side Compact button guard, which is disabled when the conversation has no stored model. `compact()` throwing in this case is a safety net only.

#### Scenario: Compaction uses stored conversation model
- **WHEN** `compact(taskId, conversationId, workingDirectory)` is called and `conversations.model` is `"pi-local/lmstudio/llama-3.2-3b"`
- **THEN** the Pi session for compaction is created or updated with model `"pi-local/lmstudio/llama-3.2-3b"` and the context window resolved from `model_settings` for that model

#### Scenario: Compaction uses correct context window from model_settings
- **WHEN** `compact()` resolves model `"pi-local/lmstudio/qwen3:8b"` and `model_settings` has `context_window = 32768` for that model
- **THEN** the Pi session used for compaction has `model.contextWindow = 32768`

#### Scenario: Compaction appends a summary message
- **WHEN** compaction is triggered (manually or automatically)
- **THEN** a `compaction_summary` message is appended to the conversation containing an AI-generated summary of prior messages

#### Scenario: Post-compaction LLM calls use summary, notes, and newer messages
- **WHEN** an LLM call is assembled after a `compaction_summary` exists in history
- **THEN** the assembled context contains: the system prompt, the compaction_summary as a system message, and only messages that occurred after it
