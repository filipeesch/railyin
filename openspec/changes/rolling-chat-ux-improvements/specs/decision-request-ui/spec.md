## ADDED Requirements

### Requirement: User messages are rendered with markdown
The system SHALL render all `user` type conversation messages using `renderMd()` and the `.prose` CSS class, the same as `assistant` messages. The `InlineChipText` component SHALL no longer be used for the user bubble in task/session chat.

#### Scenario: Decision answer markdown renders correctly
- **WHEN** a decision answer user message is displayed (containing `**Q [EASY]:**`, `**A:**` patterns)
- **THEN** bold text, inline code, and other markdown is rendered as formatted HTML, not raw asterisks

#### Scenario: Regular user chat messages render markdown
- **WHEN** a user sends a message containing markdown (bold, code blocks, etc.)
- **THEN** it renders as formatted HTML in the green user bubble

## REMOVED Requirements

### Requirement: DecisionRequest answered-view shows Q/A summary
**Reason**: The answered-view block is redundant with the user message bubble that immediately follows in the conversation, and its answer parser is broken (looks for `"A: "` but stored format is `"**A:** "`). With user messages now rendering markdown, the user bubble cleanly shows the full Q&A content.
**Migration**: Remove the `v-if="answered"` branch from `DecisionRequest.vue`. When `answeredText` is defined, the component renders nothing. The `answeredText` prop, `answered` computed, and `answeredSummary` computed can all be removed.
