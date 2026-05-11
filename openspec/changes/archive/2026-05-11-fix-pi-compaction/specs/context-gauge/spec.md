## MODIFIED Requirements

### Requirement: Context usage gauge displayed next to model selector
The system SHALL display a context usage gauge to the right of the model selector in the task detail drawer, showing estimated token usage as a fraction of the model's context window. After a `compaction_summary` message is received via `message.new` WebSocket event, the frontend SHALL re-fetch context usage for that conversation so the gauge immediately reflects the post-compaction token count.

#### Scenario: Gauge shown when context window is known
- **WHEN** the task detail drawer opens and the model's context window is known (from API or config)
- **THEN** a gauge is displayed showing used tokens / max tokens as a filled bar with a percentage label

#### Scenario: Gauge colour reflects usage level
- **WHEN** the gauge is rendered
- **THEN** it is green below 70%, yellow from 70–89%, and red at 90% and above

#### Scenario: Gauge tooltip shows detail
- **WHEN** the user hovers over the gauge
- **THEN** a tooltip shows "~X,XXX / YY,XXX tokens (Z%)"

#### Scenario: Gauge updates after execution completes
- **WHEN** an AI execution finishes and `onTaskUpdated` fires
- **THEN** the gauge re-fetches context usage and updates its display

#### Scenario: Gauge drops immediately after manual compact
- **WHEN** a `message.new` event is received with `type: "compaction_summary"` for the active conversation
- **THEN** `fetchContextUsage` is called for that conversation and the gauge updates to reflect the post-compaction token count

#### Scenario: Gauge hidden when context window is unknown
- **WHEN** the model's context window cannot be determined (API returns null and no config override)
- **THEN** the gauge is not rendered
