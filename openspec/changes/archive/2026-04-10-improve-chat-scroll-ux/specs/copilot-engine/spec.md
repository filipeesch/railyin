## MODIFIED Requirements

### Requirement: Copilot SDK events are translated to EngineEvent types
The Copilot adapter SHALL preserve enough SDK metadata for the conversation layer to render rich user-facing tool activity and suppress non-user-facing internal activity.

#### Scenario: Tool result translation preserves rich display content
- **WHEN** the SDK emits a `tool.execution_complete` event containing detailed or structured result content in addition to the concise LLM-facing text
- **THEN** the translated event keeps that richer content available to the conversation/UI layer

#### Scenario: Non-user-facing Copilot activity is not surfaced in the chat timeline
- **WHEN** the SDK identifies a message or tool-related event as hidden, internal, or otherwise non-user-facing through preserved metadata
- **THEN** that activity is not rendered as a visible conversation item

#### Scenario: User-facing tool execution still appears in order
- **WHEN** the SDK emits user-visible tool activity for a Copilot execution
- **THEN** the translated conversation items preserve the execution order needed by the timeline and remain visible in the chat UI
