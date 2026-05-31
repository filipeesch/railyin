## NEW Requirements

### Requirement: `buildDisplayItems` is a pure, importable utility
The system SHALL expose a `buildDisplayItems(messages: ConversationMessage[], hasStreamTail: boolean): DisplayItem[]` function in `src/mainview/utils/buildDisplayItems.ts`. `ConversationBody.vue` SHALL delegate its `displayItems` computed to this function. The utility SHALL have no Vue, Pinia, or DOM dependency.

#### Scenario: Orphaned subagent children produce tool_entry display items
- **GIVEN** a `messages` input whose only entries are `tool_call` rows with `metadata.parent_tool_call_id` set to an ID absent from the input
- **WHEN** `buildDisplayItems` is called with `hasStreamTail: false`
- **THEN** it returns one `{ kind: "tool_entry" }` item per orphaned child — none are dropped

#### Scenario: Regular assistant/user messages produce single display items
- **GIVEN** a `messages` input of non-tool messages
- **WHEN** `buildDisplayItems` is called
- **THEN** each message maps to a `{ kind: "single" }` item

#### Scenario: `hasStreamTail: true` appends a stream_tail item
- **GIVEN** any `messages` input
- **WHEN** `buildDisplayItems` is called with `hasStreamTail: true`
- **THEN** the last item in the result has `kind: "stream_tail"`

#### Scenario: Mixed tool + non-tool messages are correctly split into groups
- **GIVEN** a messages input: [assistant, tool_call, tool_result, assistant]
- **WHEN** `buildDisplayItems` is called
- **THEN** result is [single, tool_entry, single] — tool pair grouped, non-tool items individual
