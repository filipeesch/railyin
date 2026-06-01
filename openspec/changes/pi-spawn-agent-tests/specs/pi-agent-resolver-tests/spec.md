## ADDED Requirements

### Requirement: AgentResolver resolves named agents via three-tier chain
`AgentResolver` SHALL resolve a named agent by checking `basePaths` in order: project `.railyin/agents/<name>.md` → user `~/.railyin/agents/<name>.md` → built-in `config/agents/<name>.md`. It SHALL return the first file found.

#### Scenario: AR-1 Project-level agent takes precedence over user-level
- **WHEN** `<project>/.railyin/agents/implementer.md` exists AND `~/.railyin/agents/implementer.md` exists
- **THEN** `AgentResolver.resolve("implementer")` returns the project-level file content

#### Scenario: AR-2 User-level agent used when no project-level override
- **WHEN** `<project>/.railyin/agents/implementer.md` does NOT exist AND `~/.railyin/agents/implementer.md` exists
- **THEN** `AgentResolver.resolve("implementer")` returns the user-level file content

#### Scenario: AR-3 Built-in agent used when no overrides
- **WHEN** only `config/agents/implementer.md` exists
- **THEN** `AgentResolver.resolve("implementer")` returns the built-in file content

#### Scenario: AR-4 Unknown agent name throws descriptive error
- **WHEN** `AgentResolver.resolve("nonexistent")` is called and no file exists at any tier
- **THEN** it throws with a message listing all searched paths

#### Scenario: AR-5 Resolution order is stable with all three tiers present
- **WHEN** all three tiers have an `implementer.md` with distinct content
- **THEN** the project-level content is returned (first wins)

### Requirement: AgentResolver parses YAML frontmatter and body
`AgentResolver` SHALL parse `tools: string[]` and optional `model: string` from YAML frontmatter. The markdown body (after the `---` block) SHALL be the system prompt.

#### Scenario: AR-6 Frontmatter tools array parsed correctly
- **WHEN** agent file has `tools: [read, lsp, write]` in frontmatter
- **THEN** resolved agent has `tools: ["read", "lsp", "write"]`

#### Scenario: AR-7 Frontmatter model field is optional
- **WHEN** agent file has no `model:` key in frontmatter
- **THEN** resolved agent has `model: undefined`

#### Scenario: AR-8 Body after frontmatter becomes system prompt
- **WHEN** agent file body is `You are a senior TypeScript engineer...`
- **THEN** resolved agent has `systemPrompt: "You are a senior TypeScript engineer..."`

#### Scenario: AR-9 File with no frontmatter uses entire content as system prompt
- **WHEN** agent file has no `---` delimiters
- **THEN** resolved agent has `tools: []` and entire file content as system prompt

#### Scenario: AR-10 Invalid YAML frontmatter throws descriptive error
- **WHEN** agent file has malformed YAML between `---` delimiters
- **THEN** it throws with filename and YAML parse error message

### Requirement: AgentResolver accepts injected basePaths for testability
`AgentResolver` constructor SHALL accept an explicit `basePaths: string[]` parameter that overrides the default resolution chain, enabling tests to pass real tmpdir paths without mocking the filesystem.

#### Scenario: AR-11 Injected basePaths override defaults
- **WHEN** `new AgentResolver({ basePaths: ["/tmp/test-agents"] })` is used
- **THEN** only `/tmp/test-agents/<name>.md` is searched (not user home or cwd)

#### Scenario: AR-12 Empty basePaths makes every resolve throw
- **WHEN** `new AgentResolver({ basePaths: [] })` and `resolve("anything")` called
- **THEN** it throws with "not found" message

#### Scenario: AR-13 Multiple injected paths searched in order
- **WHEN** `basePaths: ["/tmp/tier1", "/tmp/tier2"]` and only `/tmp/tier2/coder.md` exists
- **THEN** `resolve("coder")` returns content from `/tmp/tier2/coder.md`

### Requirement: All four built-in agents are resolvable by default
`config/agents/` SHALL contain `implementer.md`, `reviewer.md`, `researcher.md`, and `tester.md` with valid frontmatter.

#### Scenario: AR-14 All four built-in agents resolve without project config
- **WHEN** no project or user agent files exist
- **THEN** `AgentResolver.resolve("implementer")`, `"reviewer"`, `"researcher"`, `"tester"` all succeed

#### Scenario: AR-15 Built-in agent frontmatter declares expected tool groups
- **WHEN** `config/agents/implementer.md` is resolved
- **THEN** its `tools` list includes `"write"` and `"lsp"` (implementer needs write access)
