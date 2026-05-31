## MODIFIED Requirements

### Requirement: Tool injection
The Pi engine's `createAgentSession` call SHALL include a `tools` allowlist derived dynamically from the built `piTools` array, prefixed with the SDK built-in names from `SDK_BUILTIN_TOOL_NAMES`. The allowlist SHALL be constructed via `buildToolAllowlist(piTools)` — a shared helper in `pi/constants.ts` — rather than a hardcoded string array. This ensures any tool registered in `buildAllTools()` is automatically included. The custom `"read_file"` tool SHALL NOT be included in the allowlist (its code is retained but not injected). Enabling `"read"` satisfies the Pi SDK's `selectedTools.includes("read")` guard, which gates skill injection into the system prompt. On session reuse, `setActiveToolsByName` SHALL also use `buildToolAllowlist(tools)`.

#### Scenario: read tool present in allowlist
- **WHEN** `createAgentSession` is called for a new Pi session
- **THEN** the `tools` array contains `"read"`
- **AND** the `tools` array does NOT contain `"read_file"`

#### Scenario: Note tools present in allowlist on session creation
- **WHEN** `createAgentSession` is called for a new Pi session
- **THEN** the `tools` array contains `"create_note"`, `"list_notes"`, and `"update_note"`

#### Scenario: Note tools present in allowlist on session reuse
- **WHEN** `setActiveToolsByName` is called for an existing Pi session
- **THEN** the names array contains `"create_note"`, `"list_notes"`, and `"update_note"`

#### Scenario: Skills injected into system prompt when dialect returns paths
- **WHEN** the configured dialect returns one or more skill paths (e.g., `.github/skills/`)
- **AND** skill files exist at those paths
- **THEN** the skills are appended to the system prompt visible to the LLM at session creation

#### Scenario: Skills NOT injected when no skill paths
- **WHEN** the configured dialect returns an empty skill path list (e.g., `NullDialect`)
- **THEN** no skills section appears in the system prompt

## ADDED Requirements

### Requirement: buildToolAllowlist shared helper
A `buildToolAllowlist(tools: AgentTool<any>[]): string[]` function SHALL exist in `src/bun/engine/pi/constants.ts`. It SHALL return `[...SDK_BUILTIN_TOOL_NAMES, ...tools.map(t => t.name)]`. All three Pi allowlist construction sites — `defaultSessionFactory`, session-reuse `setActiveToolsByName`, and `child-session.ts` — SHALL use this helper exclusively.

#### Scenario: buildToolAllowlist includes SDK built-in names
- **WHEN** `buildToolAllowlist([])` is called
- **THEN** the result contains all entries from `SDK_BUILTIN_TOOL_NAMES` (`"read"`, `"grep"`, `"find"`, `"ls"`)

#### Scenario: buildToolAllowlist includes all passed tool names
- **WHEN** `buildToolAllowlist([{ name: "create_note" }, { name: "list_todos" }])` is called
- **THEN** the result contains `"create_note"` and `"list_todos"` in addition to the built-ins
