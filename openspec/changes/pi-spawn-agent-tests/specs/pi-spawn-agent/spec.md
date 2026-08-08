## ADDED Requirements

### Requirement: AgentResolver accepts injected basePaths for testability
`AgentResolver` constructor SHALL accept an optional `basePaths: string[]` parameter. When provided, it SHALL override the default three-tier resolution path, enabling unit tests to operate on real temporary directories without mocking filesystem internals.

#### Scenario: Injected basePaths replace default resolution chain
- **WHEN** `new AgentResolver({ basePaths: [tmpdir] })` and `resolve("coder")` is called
- **THEN** only `<tmpdir>/coder.md` is searched (no user home, no process.cwd())
