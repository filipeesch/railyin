## ADDED Requirements

### Requirement: Reasoning bubble scrolls to bottom while streaming
`e2e/ui/conversation-body.spec.ts` SHALL include CB-X verifying that the `.rb__body` element inside a `ReasoningBubble` is scrolled to its bottom while reasoning content is actively streaming.

#### Scenario: CB-X — reasoning bubble .rb__body scrolled to bottom during streaming
- **WHEN** multiple `reasoning_chunk` events with substantial content are pushed while the bubble is in streaming state
- **THEN** `rb__body.scrollTop + rb__body.clientHeight >= rb__body.scrollHeight - 10` is true
