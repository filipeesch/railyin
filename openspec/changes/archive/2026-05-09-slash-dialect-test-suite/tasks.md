## 1. Migrate slash-prompt.test.ts → copilot-dialect.test.ts

- [x] 1.1 Create `src/bun/test/copilot-dialect.test.ts` — migrate all 20+ resolution scenarios from `slash-prompt.test.ts` to use `CopilotDialect` class API; update all assertions to expect `ResolvedPrompt` shape with XML-wrapped `content`
- [x] 1.2 Add CD-XML-1..7 XML wrapping assertions — verify `wasSlash`, `content` wrapper, `sourceCommand`, `sourceArgs`, no frontmatter in wrapped body, `$input` substituted inside tag
- [x] 1.3 Migrate CD-LIST-1..5 listing cases from `list-commands.test.ts` into `copilot-dialect.test.ts`
- [x] 1.4 Delete `src/bun/test/slash-prompt.test.ts`

## 2. Create claude-dialect.test.ts

- [x] 2.1 Create `src/bun/test/claude-dialect.test.ts` — implement CLD-LIST-1..7 listing cases (migrated from `list-commands.test.ts`); include subdirectory colon-path test cases
- [x] 2.2 Add CLD-RES-1..10 resolution cases — colon→path reverse mapping, XML wrapping, no frontmatter strip, scope priority, `$input` substitution, error on missing file
- [x] 2.3 Add CLD-FM-1..2 frontmatter asymmetry cases — description read for listing, frontmatter NOT stripped for resolution

## 3. Create registry and null dialect test files

- [x] 3.1 Create `src/bun/test/slash-command-dialect-registry.test.ts` — SCD-REG-1..8: register, create, unknown throws, `createDefaultDialectRegistry()`, new instance per call, last-write-wins
- [x] 3.2 Create `src/bun/test/null-dialect.test.ts` — ND-1..3: always empty list, passthrough content, slash values also pass through

## 4. Extend pi-harness.test.ts with SpyDialect

- [x] 4.1 Add `SpyDialect` helper (inline or in helpers) implementing `SlashCommandDialect` — records calls, returns controlled values
- [x] 4.2 Add PI-DI-1..4 cases — verify Pi `listCommands()` delegates to dialect, `execute()` calls `resolvePrompt()` before `session.prompt()`, default `NullDialect` backward compat

## 5. Extend engine-registry.test.ts

- [x] 5.1 Add ER-DI-1..4 cases — verify Copilot wired with `CopilotDialect`, Claude with `NullDialect`, Pi with `copilot` dialect gets `CopilotDialect`, Pi with no dialect gets `NullDialect`

## 6. Update transition-executor.test.ts

- [x] 6.1 Remove `.github/prompts/` file setup from `"stores enriched transition metadata"` test
- [x] 6.2 Update `displayText` assertion to `"/opsx-propose transition card"` (raw prompt)

## 7. Update copilot-rpc-scenarios.test.ts

- [x] 7.1 Update COP-XML-1: `"resolves slash command prompt"` scenario — assert `session.prompts` contains XML-wrapped content: `<command name="opsx-propose" args="add-dark-mode">\nResolved body: add-dark-mode\n</command>`

## 8. Clean up list-commands.test.ts

- [x] 8.1 Remove `collectCopilotCommands` test cases (migrated to step 1.3)
- [x] 8.2 Remove `collectClaudeCommands` test cases (migrated to step 2.1)
- [x] 8.3 Delete `src/bun/test/list-commands.test.ts` if no cases remain; otherwise retain only non-migrated cases
