## ADDED Requirements

### Requirement: User messages render preserved autocomplete chips as rich chips
The system SHALL render newly stored user messages containing autocomplete chip markup as rich inline chips in the conversation timeline for both task chat and standalone session chat. Rendered user-message chips SHALL preserve their sigil-prefixed visible labels (`/command`, `#file`, `#Symbol`, `@tool`) and SHALL appear inline with surrounding plain text. User messages that do not contain chip markup SHALL continue to render as plain text.

#### Scenario: Sent user message shows slash chip
- **WHEN** a newly sent user message contains stored slash chip markup
- **THEN** the conversation bubble renders an inline chip showing `/command` instead of raw `[ref|label]` text or plain text without the slash

#### Scenario: Sent user message shows file and tool chips
- **WHEN** a newly sent user message contains stored file, symbol, or MCP tool chip markup
- **THEN** the conversation bubble renders inline chips showing the `#` or `@` visible labels in their original message positions

#### Scenario: Older plain-text user message remains plain text
- **WHEN** a previously stored user message contains no chip markup
- **THEN** the conversation bubble renders the message as ordinary user text with no chip parsing requirement

## MODIFIED Requirements

### Requirement: Full conversation context is provided to AI on each call
The system SHALL include all prior conversation messages for a task as context when making an AI call, in addition to the current `stage_instructions` and the new prompt or user message. User messages stored with autocomplete chip markup SHALL be converted to derived plain/raw text before they are sent to the engine as either history or the current turn. File and symbol chips SHALL continue to contribute their structured attachment context separately, so the derived text remains clean human text rather than raw chip markup.

#### Scenario: AI receives full history
- **WHEN** an execution is triggered (on_enter_prompt or human turn)
- **THEN** the AI request includes: system message with stage_instructions, all prior conversation messages, and the new message

#### Scenario: Stored chip markup is decoded before AI call
- **WHEN** a prior or current user message contains autocomplete chip markup
- **THEN** the engine receives the derived plain/raw text form of that message, not the literal `[ref|label]` markup

#### Scenario: Stage instructions are always prepended
- **WHEN** any AI call is made for a task
- **THEN** the current column's `stage_instructions` are included as a system message regardless of whether it is a prompt-triggered or human-initiated call
