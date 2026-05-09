## 1. Dialect Interface and Core Types

- [ ] 1.1 Create `src/bun/engine/dialects/slash-command-dialect.ts` — define `SlashCommandDialect` interface, `ResolvedPrompt` interface
- [ ] 1.2 Create `src/bun/engine/dialects/null-dialect.ts` — implement `NullDialect` (passthrough, `listCommands` returns `[]`)
- [ ] 1.3 Create `src/bun/engine/dialects/registry.ts` — implement `SlashCommandDialectRegistry` with `register()`, `create()`, and `createDefaultDialectRegistry()` factory

## 2. CopilotDialect (refactor from copilot-prompt-resolver.ts)

- [ ] 2.1 Create `src/bun/engine/dialects/copilot-dialect.ts` — implement `CopilotDialect` with `listCommands()` (absorbing `collectCopilotCommands`) and `resolvePrompt()` (absorbing `resolvePrompt` from `copilot-prompt-resolver.ts`), including XML-wrapping of resolved content
- [ ] 2.2 Delete `src/bun/engine/dialects/copilot-prompt-resolver.ts` — update all import sites to use `CopilotDialect`

## 3. ClaudeDialect (new)

- [ ] 3.1 Create `src/bun/engine/dialects/claude-dialect.ts` — implement `ClaudeDialect` with `listCommands()` scanning `.claude/commands/*.md` across worktree → projectRoot → `~/.claude/commands/`, and `resolvePrompt()` with XML-wrapping (no frontmatter strip)

## 4. Register Dialects in EngineRegistry

- [ ] 4.1 Wire `createDefaultDialectRegistry()` in `EngineRegistry` constructor — store a `Map<engineId, SlashCommandDialect>` built from each engine's config at construction time

## 5. CopilotEngine — use CopilotDialect

- [ ] 5.1 Inject `CopilotDialect` into `CopilotEngine` constructor — replace direct calls to `resolvePrompt` free-function and `collectCopilotCommands` with dialect methods
- [ ] 5.2 Remove `collectCopilotCommands` export from `copilot/engine.ts` (moved to `CopilotDialect`)

## 6. PiEngine — configurable dialect

- [ ] 6.1 Add `dialect?: "copilot" | "claude" | "none"` field to `PiEngineConfig` in `src/bun/config/index.ts`
- [ ] 6.2 Inject `SlashCommandDialect` into `PiEngine` constructor via registry lookup on `cfg.dialect ?? "none"`
- [ ] 6.3 Implement `PiEngine.listCommands()` — delegate to `this.dialect.listCommands(worktreePath, projectPath)`
- [ ] 6.4 Call `this.dialect.resolvePrompt()` in `PiEngine.createManagedExecution()` before passing prompt to `session.prompt()`

## 7. TransitionExecutor — remove dead-code resolution block

- [ ] 7.1 Delete the `engineId === "copilot"` branch in `TransitionExecutor.buildTransitionMetadata()` — assign `displayText = prompt` unconditionally (UI always shows `sourceText` for slash commands, so the expanded body was never rendered)

## 8. Config and Documentation

- [ ] 8.1 Update `config/engines.yaml.sample` — add `dialect:` field with a comment documenting accepted values (`copilot`, `claude`, `none`) and defaulting behavior for Pi engine entries
