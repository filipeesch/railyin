## Why

Users need model-setting controls in chat (for example effort/speed-depth modes) in the same places they already choose models. Today this is inconsistent across engines and contexts, and the current API surface does not expose a normalized capability/default contract that can be rendered safely without hardcoding.

## What Changes

- Expose per-conversation model-setting controls in both task chat and session chat for the v1 engine trio: Copilot, Cursor, and Claude.
- Extend model metadata returned by `models.listEnabled` to include normalized model-setting metadata plus raw provider metadata for strict-discovery traceability.
- Persist selected per-conversation setting values in the conversation record (including default materialization behavior on model switch).
- Enforce compatibility rules on model change:
  - keep compatible values when possible,
  - auto-clear and hide controls for unsupported models,
  - persist model default when no explicit override is present and a default is exposed.
- Add Cursor variant-as-effort mapping using discovered variants/parameters (no static model-name hardcoding).

## Capabilities

### New Capabilities

- `model-settings-metadata`: Introduce a normalized+raw model-settings metadata contract for API/UI consumption in chat model controls.

### Modified Capabilities

- `model-selection`: Extend enabled-model responses and selection behavior to carry model-setting capability/default/options metadata.
- `model-reasoning`: Generalize and align effort-style controls across Copilot, Claude, and Cursor-discovered variants.
- `task`: Add task-chat model-setting selection behavior and persistence integration via conversation scope.
- `chat-session`: Add session-chat model-setting selection behavior and persistence integration via conversation scope.

## Impact

- Backend handlers and shared RPC contract (`models.listEnabled`, conversation-level update/read paths).
- Engine adapters/model discovery mapping for Copilot, Claude, and Cursor.
- Chat UI model row behavior in both task and session contexts.
- Conversation persistence schema and compatibility/default application flow during model switches.

## Aligned Test Scenarios

### Unit scenarios

- Normalize model-setting metadata per engine:
  - Copilot exposes discovered supported/default efforts.
  - Claude exposes discovered supported/default efforts.
  - Cursor maps eligible variants (for example `Fast`, `Normal`) to reasoning-mode options.
  - Cursor ignores non-eligible variants (strict discovery only).
- Model-switch compatibility policy:
  - keep value when the next model supports it,
  - clear value and hide control when unsupported,
  - persist discovered default when no explicit override exists.
- Frontend shared selector behavior (task + session parity):
  - control visible when supported values are non-empty,
  - control hidden when supported values are empty,
  - provider-native option labels are rendered unchanged.

### Integration scenarios (in-memory DB)

- Conversation persistence lifecycle:
  - setting is stored in conversation column,
  - value is reused by subsequent sends in same conversation.
- Task flow + session flow parity:
  - same conversation-setting rules apply in both contexts.
- Model-switch persistence transitions:
  - compatible retain,
  - incompatible clear,
  - no explicit override + discovered default => default persisted.

### API integration scenarios

- `models.listEnabled` returns hybrid normalized+raw metadata contract.
- Unsupported models return empty supported-values list so UI hides control.
- `tasks.setModel` and `chatSessions.setModel` trigger compatibility/default persistence logic on conversation setting.

### Playwright scenarios

- Task chat:
  - selector appears for supported model and hides for unsupported model,
  - switching supported->unsupported clears stale UI value,
  - switching with no explicit override materializes/persists model default.
- Session chat:
  - same visibility/clear/default behavior as task chat.
- Cross-surface consistency:
  - provider-native labels (for example Cursor `Fast`/`Normal`) remain intact,
  - persisted value survives reopen/reload for the same conversation.
