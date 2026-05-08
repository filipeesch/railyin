## ADDED Requirements

### Requirement: Copilot subagent tool calls are visible in the live stream
The system SHALL NOT suppress tool call events that have a `parentCallId` from appearing in the live stream. Only tools that are truly internal (skill source prefix, `report_intent`, `internal_*`, `copilot_*`) SHALL be suppressed via `isInternal`.

#### Scenario: Subagent tool call appears as child block during streaming
- **WHEN** a Copilot subagent emits a `tool_call` event with `parentToolCallId` set
- **THEN** the stream event is emitted with `isInternal: false` and appears as a child block under its spawning tool in the live stream

#### Scenario: report_intent remains suppressed
- **WHEN** a Copilot event has `toolName === 'report_intent'`
- **THEN** `isInternal` is `true` and the event is not emitted to the UI

### Requirement: Horizontal scrollbar is suppressed in the chat conversation panel
The system SHALL set `overflow-x: hidden` on the `.conv-body` element in `ConversationBody.vue` so that wide child content (ReadView, FileDiff, pre blocks) does not propagate a horizontal scrollbar to the outer chat panel.

#### Scenario: Long file content does not cause outer horizontal scroll
- **WHEN** a ReadView renders a file with lines longer than the panel width
- **THEN** only the ReadView scrolls horizontally; the conversation panel shows no horizontal scrollbar
