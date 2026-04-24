## Purpose
Defines the chat input editor behaviour: a CodeMirror 6 editor with dynamic height and atomic chip token rendering for autocomplete references.

## Requirements

### Requirement: Chat input uses a CodeMirror 6 editor with dynamic height
The system SHALL replace the plain textarea in the task chat compose area with a CodeMirror 6 editor that expands vertically as the user types, up to a maximum height, then scrolls. The editor SHALL expose the same `modelValue` / `onUpdate:modelValue` interface so existing send, paste, and keyboard shortcut behaviour is preserved. The editor SHALL wrap long lines to fit its container width, without producing horizontal scrollbars or causing the input row to grow wider than the available space.

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

#### Scenario: Long unbroken line wraps within the input row
- **WHEN** the user types a long line without pressing Enter
- **THEN** the text wraps inside the editor and the input row does NOT grow horizontally beyond its container

### Requirement: Editor re-enables after AI turn ends
The system SHALL re-enable the chat editor for user input as soon as the task's execution state transitions away from `running`, without requiring the drawer to be closed and reopened. The editor's `disabled` prop is set by the parent component; the editor SHALL respond to this prop change dynamically using a CM6 `Compartment` so the editable state can be hot-swapped at runtime.

#### Scenario: Editor unlocks when AI turn completes
- **WHEN** the AI turn ends and `task.executionState` changes from `running` to any other state
- **THEN** the chat editor becomes interactive immediately, without requiring any drawer interaction

#### Scenario: Editor locks while AI is running
- **WHEN** `task.executionState` is `running`
- **THEN** the chat editor is not editable and the send button is disabled

### Requirement: Chat editor is visually distinct from the drawer background
The system SHALL render the chat editor with a background colour matching PrimeVue input components (e.g. `<InputText>`, `<Textarea>`), so the editor is recognisable as an interactive input field and does not visually merge with the surrounding drawer panel.

#### Scenario: Editor background in light mode
- **WHEN** the application is in light mode
- **THEN** the chat editor background matches the PrimeVue input background token (`--p-inputtext-background`) and is distinct from the drawer panel background

#### Scenario: Editor background in dark mode
- **WHEN** the application is in dark mode
- **THEN** the chat editor background matches the PrimeVue input background token for dark mode and is distinct from the drawer panel background

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

### Requirement: Chat editor works in standalone session chat
The system SHALL render the shared CodeMirror chat editor in standalone session chat as well as task chat. Session chat SHALL preserve the same submit, newline, and dynamic-height behavior as task chat.

#### Scenario: Session editor uses CodeMirror input
- **WHEN** the user opens a standalone chat session
- **THEN** the compose area is rendered with the shared CodeMirror chat editor instead of a plain textarea

#### Scenario: Session editor preserves keyboard behavior
- **WHEN** the user types in a standalone chat session and presses Enter or Shift+Enter
- **THEN** the editor behaves identically to task chat for submit and newline actions

### Requirement: Session autocomplete is workspace scoped
The system SHALL offer chat-editor autocomplete in standalone sessions using the workspace root as the discovery scope when no task worktree is available.

#### Scenario: Session file autocomplete resolves within workspace
- **WHEN** the user triggers file autocomplete in a standalone chat session
- **THEN** completion results are searched from the active workspace root rather than requiring a task worktree

#### Scenario: Missing workspace root falls back safely
- **WHEN** the active workspace has no configured workspace root path
- **THEN** the editor remains usable and autocomplete falls back to the existing compatible workspace path resolution
