## ADDED Requirements

### Requirement: Language Servers tab exists in SetupView
SetupView must contain a dedicated "Language Servers" tab where users manage workspace-scoped LSP configuration.

#### Scenario: LS-1 Language Servers tab is visible
- **WHEN** the user opens SetupView
- **THEN** a "Language Servers" tab is visible alongside Workspace, Projects, Boards, and Models

#### Scenario: LS-2 Language Servers tab shows empty state
- **WHEN** the user navigates to the Language Servers tab and no scan has been run
- **THEN** an empty-state message and a "Scan for languages" button are shown

#### Scenario: LS-3 Scan detects languages
- **WHEN** the user clicks "Scan for languages"
- **THEN** `lsp.detectLanguages` is called with the workspace root path and active `workspaceKey`
- **THEN** detected languages are shown as cards in `LspSetupPrompt`

#### Scenario: LS-4 inConfig hides Add-to-config button
- **WHEN** a detected language's server is already in `workspace.yaml lsp.servers`
- **THEN** the "Add to workspace config" button is hidden for that language card
- **THEN** a "✓ In config" indicator is shown instead

#### Scenario: LS-5 No workspace path hint
- **WHEN** the scan returns no languages and workspace path is not set
- **THEN** a hint is shown suggesting the user set the workspace path first

### Requirement: Projects tab shows LSP status badge per row
Each project row in the Projects tab must display a read-only LSP status indicator.

#### Scenario: LS-6 Status badge — servers configured
- **WHEN** the active workspace has N ≥ 1 entries in `workspace.yaml lsp.servers`
- **THEN** each project row shows a green "N LSP" badge

#### Scenario: LS-7 Status badge — no servers
- **WHEN** the active workspace has no entries in `workspace.yaml lsp.servers`
- **THEN** each project row shows a secondary "No LSP" badge

#### Scenario: LS-8 Shortcut navigates to Language Servers tab
- **WHEN** the user clicks the LSP shortcut button on a project row
- **THEN** SetupView switches to the Language Servers tab

### Requirement: Inline LspSetupPrompt removed from Projects tab
The Projects tab must not expand an inline `LspSetupPrompt` component.

#### Scenario: LS-9 No inline prompt
- **WHEN** the user is on the Projects tab (after adding a project or clicking gear)
- **THEN** no `LspSetupPrompt` component is rendered inline in that tab

### Requirement: detectLanguages returns inConfig per language
The `lsp.detectLanguages` RPC must report whether each detected server is already in `workspace.yaml`.

#### Scenario: LS-10 inConfig true when server in config
- **WHEN** `lsp.detectLanguages` is called and a detected server's name matches an entry in `workspace.yaml lsp.servers`
- **THEN** the response for that language has `inConfig: true`

#### Scenario: LS-11 inConfig false when server not in config
- **WHEN** `lsp.detectLanguages` is called and a detected server is not in `workspace.yaml lsp.servers`
- **THEN** the response for that language has `inConfig: false`

#### Scenario: LS-12 detectLanguages accepts workspaceKey
- **WHEN** `lsp.detectLanguages` is called with a `workspaceKey` param
- **THEN** the handler reads the correct workspace config to determine `inConfig`
