## ADDED Requirements

### Requirement: User can configure LSP for an existing project
The system SHALL provide a "Configure LSP" action in the project list row of the Setup view. Activating this action SHALL trigger language detection for the project's path and, if languages are detected, display the `LspSetupPrompt` component inline. The prompt SHALL operate in dismiss-only mode so that completing setup closes the prompt without navigating away from the Setup view.

#### Scenario: Configure LSP button triggers language detection
- **WHEN** the user clicks the "Configure LSP" icon button in a project's row
- **THEN** the system calls `lsp.detectLanguages` with the project's absolute path and shows a loading indicator

#### Scenario: Languages detected — LSP prompt shown
- **WHEN** `lsp.detectLanguages` returns one or more detected languages for a project
- **THEN** `LspSetupPrompt` is displayed with the detected languages, the project path, and the active `workspaceKey`

#### Scenario: No languages detected — feedback shown
- **WHEN** `lsp.detectLanguages` returns no languages for a project
- **THEN** the prompt is not shown and the user receives inline feedback indicating no supported languages were detected

#### Scenario: LSP prompt dismissed after setup completes
- **WHEN** the user completes or skips LSP setup via `LspSetupPrompt` in dismiss-only mode
- **THEN** the prompt is hidden and the user remains on the Setup view (no navigation occurs)
