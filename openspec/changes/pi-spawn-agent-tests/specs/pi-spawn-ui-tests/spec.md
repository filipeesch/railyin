## ADDED Requirements

### Requirement: Child agent tokens stream nested inside spawn_agent card in live UI
When child `text_chunk` StreamEvents arrive with `parentBlockId` matching a `spawn_agent` tool_call block's blockId, the frontend SHALL render those tokens inside the spawn_agent card — not as top-level messages.

#### Scenario: SAS-1 Child tokens appear inside spawn_agent tool card
- **WHEN** a `tool_call` StreamEvent with `blockId: "spawn-call-1"` and `toolName: "spawn_agent"` is pushed
- **AND** then a `text_chunk` StreamEvent with `parentBlockId: "spawn-call-1"` arrives
- **THEN** the token text is visible inside the spawn_agent card's children area
- **AND** NOT rendered as a standalone top-level message bubble

#### Scenario: SAS-2 Child tool_call renders nested under spawn_agent card
- **WHEN** a `tool_call` StreamEvent for `read_file` with `parentBlockId: "spawn-call-1"` arrives
- **THEN** the read_file tool card appears nested inside the spawn_agent card (not at root level)

#### Scenario: SAS-3 Multiple children render independently under their own calls
- **WHEN** two spawn_agent calls are active with blockIds "spawn-1" and "spawn-2"
- **AND** text_chunks arrive for both (interleaved)
- **THEN** each token group appears under its respective spawn card

#### Scenario: SAS-4 Spawn_agent card shows child count badge
- **WHEN** a spawn_agent tool_call has 3 nested child events
- **THEN** the spawn_agent card displays a badge indicating child activity

#### Scenario: SAS-5 Reload matches live structure
- **WHEN** the live session is reloaded after spawn_agent completes
- **THEN** the nested structure (child tokens and tool calls inside spawn_agent card) matches what was shown during streaming
