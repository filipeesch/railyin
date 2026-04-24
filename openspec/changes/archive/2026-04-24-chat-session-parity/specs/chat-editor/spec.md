## ADDED Requirements

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

