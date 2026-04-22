## MODIFIED Requirements

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

## ADDED Requirements

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
