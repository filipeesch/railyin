## ADDED Requirements

### Requirement: `buildToolAllowlist` produces correct union of SDK built-ins and custom tools
The test suite SHALL verify that `buildToolAllowlist(tools)` returns the full union of `SDK_BUILTIN_TOOL_NAMES` and the names of all custom tools passed in.

#### Scenario: BTL-1 — empty tools list returns only SDK built-ins
- **WHEN** `buildToolAllowlist([])` is called
- **THEN** the result equals `SDK_BUILTIN_TOOL_NAMES` exactly

#### Scenario: BTL-2 — custom tools appended after SDK built-ins
- **WHEN** `buildToolAllowlist([{ name: "create_note" }, { name: "list_notes" }])` is called
- **THEN** the result includes all `SDK_BUILTIN_TOOL_NAMES` followed by `"create_note"` and `"list_notes"`

#### Scenario: BTL-3 — all pi tools produce a superset
- **WHEN** `buildToolAllowlist(buildAllTools(...))` is called with a real tool list
- **THEN** the result includes every SDK built-in name and every custom tool name

#### Scenario: BTL-4 — no duplicates in output
- **WHEN** `buildToolAllowlist(tools)` is called with any valid tool list
- **THEN** the returned array has no duplicate entries

### Requirement: Pi SDK session exposes note tool names on first execution
The test suite SHALL verify that `create_note`, `list_notes`, and `update_note` are present in the active tool names of a freshly-created Pi SDK session.

#### Scenario: IT-NOTE-1 — note tools present in session tool names on session creation
- **WHEN** `PiEngine` creates a new session via `defaultSessionFactory` for the first execution of a conversation
- **THEN** the session's active tool names include `"create_note"`, `"list_notes"`, and `"update_note"`

#### Scenario: IT-NOTE-2 — note tools present after session reuse (`setActiveToolsByName`)
- **WHEN** `PiEngine` executes a second turn for the same conversation
- **THEN** `setActiveToolsByName` is called with a list that includes `"create_note"`, `"list_notes"`, and `"update_note"`

#### Scenario: IT-NOTE-3 — note tool invocation from LLM creates a persisted note
- **WHEN** the faux LLM triggers a `create_note` tool call with `content: "test note"`
- **THEN** `NoteRepository.listByConversation(conversationId)` returns exactly one note with that content
