## ADDED Requirements

### Requirement: Attachment history rendering in conversation timeline
The system SHALL render attachment chips inside persisted user message bubbles in the conversation history when the message content contains file chip syntax (`[#ref|label]`). Each chip is rendered by the `InlineChipText` component with the `.inline-chip-text__chip--file` CSS class.

> **Implementation note**: `metadata.attachments` stores binary data for the AI engine and is NOT used for UI rendering. File chips in the conversation history come from `[#ref|label]` syntax embedded in message content, parsed by `segmentChipText()` in `src/mainview/utils/chat-chips.ts`.

#### Scenario: Single file chip syntax in message content renders a chip in the history bubble
- **WHEN** the conversation loads a user message whose content contains `[#README.md|#README.md]`
- **THEN** one `.inline-chip-text__chip--file` chip is visible within the rendered message bubble and displays the label text

#### Scenario: Two file chip references in content render two chips
- **WHEN** the conversation loads a user message whose content contains two `[#ref|label]` tokens
- **THEN** two `.inline-chip-text__chip--file` chips are visible within the same message bubble

#### Scenario: Message without chip syntax renders no file chips
- **WHEN** the conversation loads a user message with plain text content (no `[#ref|label]` tokens)
- **THEN** no `.inline-chip-text__chip--file` chip is rendered in the message bubble
