## Purpose
Defines how the `conversations` table stores a per-conversation sampling preset override and how that value is exposed through the `Task`, `ChatSession` types and the `conversations.setSamplingPreset` RPC method.

## Requirements

### Requirement: conversations table stores sampling preset override
The `conversations` table SHALL have a `sampling_preset_override TEXT NULL` column. A NULL value means "Auto" — no override, defer to the column/engine defaults. A non-null value is a preset name string that overrides all lower-priority defaults for that conversation.

#### Scenario: New conversations default to Auto
- **WHEN** a new task or chat session is created
- **THEN** its associated conversation row has `sampling_preset_override = NULL`

#### Scenario: Storing a preset override
- **WHEN** `conversations.setSamplingPreset` is called with a valid preset name and a conversation ID
- **THEN** `conversations.sampling_preset_override` is updated to that preset name

#### Scenario: Resetting to Auto
- **WHEN** `conversations.setSamplingPreset` is called with `preset: null`
- **THEN** `conversations.sampling_preset_override` is set to NULL

#### Scenario: Override survives column transitions
- **WHEN** a task with a non-null `sampling_preset_override` is moved to a column that has a different `sampling_preset`
- **THEN** the transition does NOT clear or overwrite `conversations.sampling_preset_override`

### Requirement: Task and ChatSession types expose the override
The `Task` type in `rpc-types.ts` SHALL include `samplingPresetOverride: string | null`. The `ChatSession` type SHALL include `samplingPresetOverride: string | null`. Both SHALL be populated from `conversations.sampling_preset_override` via the existing conversation JOIN used for the `model` field.

#### Scenario: Task carries samplingPresetOverride
- **WHEN** `tasks.list` or `tasks.get` returns a task whose conversation has a non-null `sampling_preset_override`
- **THEN** `task.samplingPresetOverride` equals that preset name

#### Scenario: ChatSession carries samplingPresetOverride
- **WHEN** `chatSessions.list` returns sessions
- **THEN** each entry includes `samplingPresetOverride` matching `conversations.sampling_preset_override`

### Requirement: conversations.setSamplingPreset RPC method
The system SHALL expose an RPC method `conversations.setSamplingPreset` that accepts `{ conversationId: number; preset: string | null }` and writes the value to `conversations.sampling_preset_override`.

#### Scenario: setSamplingPreset sets a named preset
- **WHEN** `conversations.setSamplingPreset({ conversationId: 5, preset: "creative" })` is called
- **THEN** `conversations.sampling_preset_override` for conversation 5 equals `"creative"` and the RPC returns void

#### Scenario: setSamplingPreset clears the override
- **WHEN** `conversations.setSamplingPreset({ conversationId: 5, preset: null })` is called
- **THEN** `conversations.sampling_preset_override` for conversation 5 is NULL
