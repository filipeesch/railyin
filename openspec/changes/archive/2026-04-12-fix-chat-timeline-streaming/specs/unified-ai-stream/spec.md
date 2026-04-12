## ADDED Requirements

### Requirement: Orchestrator associates tool calls with preceding reasoning context
The orchestrator's `consumeStream()` SHALL track a `reasoningBlockId` when reasoning is flushed due to a `tool_start` event. Subsequent `tool_call` StreamEvents emitted in the same reasoning-to-text phase SHALL have their `parentBlockId` set to the reasoning block's ID, so the UI can render tool calls as children of the reasoning bubble. The `reasoningBlockId` SHALL be cleared when `token` events arrive (indicating the reasoning phase ended and assistant text is beginning).

#### Scenario: Tool calls after reasoning are grouped under the reasoning block
- **WHEN** the orchestrator receives reasoning events followed by tool_start events before any token events
- **THEN** the tool_call StreamEvents have `parentBlockId` set to the ID of the persisted reasoning block

#### Scenario: Tool calls after text tokens are not grouped under reasoning
- **WHEN** the orchestrator receives token events followed by tool_start events (no preceding reasoning phase)
- **THEN** the tool_call StreamEvents have `parentBlockId = null` (root level)

#### Scenario: Reasoning block ID clears when text tokens arrive
- **WHEN** the orchestrator emits a reasoning block, then tool calls, then receives token events
- **THEN** tool calls emitted after the token events do not reference the earlier reasoning block
