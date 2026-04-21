## Purpose
Provides `#`-triggered autocomplete in the chat editor for selecting files and symbols, resolving them to content at send time.

## Requirements

### Requirement: Typing `#` in the chat editor triggers a unified file and symbol picker
The system SHALL open an autocomplete dropdown when the user types `#` in the chat editor. The dropdown SHALL show two sections: **Files** (always available) and **Symbols** (progressively loaded via LSP). Both sections SHALL support fuzzy search on their respective names as the user continues typing.

#### Scenario: File results appear immediately on `#`
- **WHEN** the user types `#` in the chat editor
- **THEN** the dropdown opens with a Files section populated from `git ls-files` (worktree-scoped), showing filename and relative path

#### Scenario: Symbol results appear progressively
- **WHEN** the LSP is running and responds to `workspace/symbol`
- **THEN** a Symbols section appears in the dropdown alongside the Files section

#### Scenario: Symbol section shows loading state while LSP warms up
- **WHEN** the user types `#` and the LSP has not started yet
- **THEN** a spinner is shown in the Symbols section while LSP initialisation is triggered; files remain immediately accessible

#### Scenario: File search uses filename only, result shows full path
- **WHEN** the user types `#foo`
- **THEN** files are matched by base filename (`foo`), and results display the full relative path to disambiguate files with identical names in different directories

#### Scenario: Symbol search is fuzzy on symbol name
- **WHEN** the user types `#parseU`
- **THEN** symbols whose names fuzzy-match `parseU` are shown (e.g. `parseUserInput`)

#### Scenario: LSP unavailable degrades gracefully
- **WHEN** no LSP server is configured for the task's project
- **THEN** the Symbols section is absent; the Files section works normally with no error state

### Requirement: Selected `#` references resolve to content at send time
The system SHALL NOT fetch file or symbol content when a `#` reference chip is inserted. At send time, each `#` chip in the editor content SHALL be resolved: file chips read full file content and inject it as a context attachment; symbol chips read the symbol's line range from LSP and inject a fenced code snippet. Resolved content is added to `pendingAttachments` alongside any explicit file attachments.

#### Scenario: File chip resolved at send
- **WHEN** the user sends a message containing a `#file` chip for `src/foo.ts`
- **THEN** the full content of `src/foo.ts` is added as a text attachment sent with the message; the chip text in the prompt reads the file's relative path

#### Scenario: Symbol chip resolved at send
- **WHEN** the user sends a message containing a `#symbol` chip for `parseUserInput`
- **THEN** the symbol's code range is extracted and injected as a fenced code block attachment; the chip text in the prompt names the symbol and its file

#### Scenario: Large file is capped
- **WHEN** a referenced file exceeds 100 KB
- **THEN** the content is truncated at 100 KB and a notice appended; the attachment is still sent

#### Scenario: File not found at send time
- **WHEN** a `#file` chip references a file that no longer exists at send time
- **THEN** a warning toast is shown and the attachment is skipped; the message is still sent
