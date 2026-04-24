## MODIFIED Requirements

### Requirement: Inserted references render as atomic chip tokens in the editor
The system SHALL render selected autocomplete references (slash commands, file/symbol references, MCP tool references) as visual chip decorations inside the editor. Each chip SHALL be atomic: a single Backspace keystroke removes the entire chip, not character-by-character. Chips SHALL display a short, sigil-prefixed label and an icon appropriate to their type. The underlying editor document SHALL preserve structured chip markup for these selections so newly sent messages can retain and re-render the reference semantics after send.

#### Scenario: Slash command chip appearance
- **WHEN** the user selects a `/` completion (e.g. `/opsx-propose`)
- **THEN** the trigger text is replaced by a chip showing a command icon and the visible label `/opsx-propose`

#### Scenario: File reference chip appearance
- **WHEN** the user selects a `#` file completion
- **THEN** the trigger text is replaced by a chip showing a file icon and the visible label `#<baseName>`

#### Scenario: Symbol reference chip appearance
- **WHEN** the user selects a `#` symbol completion
- **THEN** the trigger text is replaced by a chip showing a symbol icon (e.g. `{}`) and the visible label `#<symbolName>`

#### Scenario: MCP tool chip appearance
- **WHEN** the user selects an `@` MCP tool completion
- **THEN** the trigger text is replaced by a chip showing a tool icon and the visible label `@<toolName>`

#### Scenario: Chip is deleted atomically with Backspace
- **WHEN** the cursor is immediately after a chip and the user presses Backspace
- **THEN** the entire chip is removed in one keystroke

#### Scenario: Chip cannot be partially edited
- **WHEN** the user places the cursor inside a chip and types
- **THEN** the cursor is moved to just after the chip; no characters are inserted within it
