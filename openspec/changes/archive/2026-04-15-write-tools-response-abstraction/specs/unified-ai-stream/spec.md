## MODIFIED Requirements

### Requirement: Orchestrator associates tool calls with preceding reasoning context
The orchestrator's `consumeStream()` SHALL keep stable parent linkage for tool-related events. Tool calls and their associated tool results/file-change visualization SHALL remain correlated by tool call identity while preserving explicit parent call relationships for nesting.

#### Scenario: Tool calls after reasoning are grouped under the reasoning block
- **WHEN** the orchestrator receives reasoning events followed by tool_start events before any token events
- **THEN** the tool_call StreamEvents have `parentBlockId` set to the ID of the persisted reasoning block

#### Scenario: Tool calls after text tokens are not grouped under reasoning
- **WHEN** the orchestrator receives token events followed by tool_start events (no preceding reasoning phase)
- **THEN** the tool_call StreamEvents have `parentBlockId = null` (root level)

#### Scenario: Reasoning block ID clears when text tokens arrive
- **WHEN** the orchestrator emits a reasoning block, then tool calls, then receives token events
- **THEN** tool calls emitted after the token events do not reference the earlier reasoning block

#### Scenario: File-change stream nodes stay linked to originating tool call
- **WHEN** the execution emits tool-level file-change data for a tool result
- **THEN** stream nodes for those file changes are emitted with parent linkage that keeps them associated with the originating tool call in the stream tree
