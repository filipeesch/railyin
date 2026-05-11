## MODIFIED Requirements

### Requirement: Tool injection
The Pi engine's `createAgentSession` call SHALL include a `tools` allowlist that enables the Pi SDK's built-in `"read"` tool alongside search tools (`"grep"`, `"find"`, `"ls"`) and all Railyin custom tools. The custom `"read_file"` tool SHALL NOT be included in the allowlist (its code is retained but not injected). Enabling `"read"` satisfies the Pi SDK's `selectedTools.includes("read")` guard, which gates skill injection into the system prompt.

#### Scenario: read tool present in allowlist
- **WHEN** `createAgentSession` is called for a new Pi session
- **THEN** the `tools` array contains `"read"`
- **AND** the `tools` array does NOT contain `"read_file"`

#### Scenario: Skills injected into system prompt when dialect returns paths
- **WHEN** the configured dialect returns one or more skill paths (e.g., `.github/skills/`)
- **AND** skill files exist at those paths
- **THEN** the skills are appended to the system prompt visible to the LLM at session creation

#### Scenario: Skills NOT injected when no skill paths
- **WHEN** the configured dialect returns an empty skill path list (e.g., `NullDialect`)
- **THEN** no skills section appears in the system prompt

## ADDED Requirements

### Requirement: Explicit skill invocation unaffected
`additionalSkillPaths` SHALL remain set on `DefaultResourceLoader` so that `resourceLoader.getSkills()` returns the correct skills for explicit `/skill:name` invocations within the Pi session. This is independent of system prompt injection.

#### Scenario: Explicit skill invocation resolves correctly
- **WHEN** a user sends `/skill:openspec-propose` in a Pi session
- **AND** the copilot dialect returned `.github/skills/` as a skill path
- **THEN** the Pi SDK resolves the skill by name from the loaded skill list
