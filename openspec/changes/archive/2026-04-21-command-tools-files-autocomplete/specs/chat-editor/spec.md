## ADDED Requirements

### Requirement: Chat input uses a CodeMirror 6 editor with dynamic height
The system SHALL replace the plain textarea in the task chat compose area with a CodeMirror 6 editor that expands vertically as the user types, up to a maximum height, then scrolls. The editor SHALL expose the same `modelValue` / `onUpdate:modelValue` interface so existing send, paste, and keyboard shortcut behaviour is preserved.

#### Scenario: Editor grows with content
- **WHEN** the user types multiple lines of text
- **THEN** the editor height increases to fit the content up to the configured maximum, without horizontal scrollbars

#### Scenario: Editor scrolls beyond max height
- **WHEN** content exceeds the maximum editor height
- **THEN** the editor stops growing and a vertical scrollbar appears inside the editor

#### Scenario: Submit shortcut is preserved
- **WHEN** the user presses Enter (without Shift)
- **THEN** the message is submitted, identical to the previous textarea behaviour

#### Scenario: Newline shortcut is preserved
- **WHEN** the user presses Shift+Enter
- **THEN** a newline is inserted into the editor content

### Requirement: Inserted references render as atomic chip tokens in the editor
The system SHALL render selected autocomplete references (slash commands, file/symbol references, MCP tool references) as visual chip decorations inside the editor. Each chip SHALL be atomic: a single Backspace keystroke removes the entire chip, not character-by-character. Chips SHALL display a short label and an icon appropriate to their type.

#### Scenario: Slash command chip appearance
- **WHEN** the user selects a `/` completion (e.g. `/opsx-propose`)
- **THEN** the trigger text is replaced by a chip showing a command icon and the command name

#### Scenario: File reference chip appearance
- **WHEN** the user selects a `#` file completion
- **THEN** the trigger text is replaced by a chip showing a file icon and the file's base name

#### Scenario: Symbol reference chip appearance
- **WHEN** the user selects a `#` symbol completion
- **THEN** the trigger text is replaced by a chip showing a symbol icon (e.g. `{}`) and the symbol name

#### Scenario: MCP tool chip appearance
- **WHEN** the user selects an `@` MCP tool completion
- **THEN** the trigger text is replaced by a chip showing a tool icon and `server:toolName`

#### Scenario: Chip is deleted atomically with Backspace
- **WHEN** the cursor is immediately after a chip and the user presses Backspace
- **THEN** the entire chip is removed in one keystroke

#### Scenario: Chip cannot be partially edited
- **WHEN** the user places the cursor inside a chip and types
- **THEN** the cursor is moved to just after the chip; no characters are inserted within it
