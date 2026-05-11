## Why

Pi engine currently returns an empty command list and passes prompts raw to the LLM, meaning slash commands don't work for Pi users at all. As Railyin gains more harness-style engines (engines with direct filesystem access and full prompt control), the existing copilot-specific dialect resolver needs to become a proper, extensible abstraction that any engine can opt into — without hardcoding engine-type checks across the codebase.

## What Changes

- Introduce a `SlashCommandDialect` interface in `src/bun/engine/dialects/` with `listCommands()` and `resolvePrompt()` methods
- Introduce a `SlashCommandDialectRegistry` that maps dialect names (e.g. `"copilot"`, `"claude"`, `"none"`) to factory functions — open for extension without modification
- Introduce a `CopilotDialect` implementation (absorbing `copilot-prompt-resolver.ts`) that scans `.github/prompts/*.prompt.md` and XML-wraps resolved content as `<command name="…" args="…">…</command>`
- Introduce a `ClaudeDialect` implementation that scans `.claude/commands/*.md` with the same lookup priority and XML-wrap behavior (for harness engines that want to follow Claude's file convention)
- Introduce a `NullDialect` (passthrough / no commands) for engines whose SDK resolves natively
- Add a `dialect?: "copilot" | "claude" | "none"` config field to `PiEngineConfig`; default is `"none"` (opt-in)
- Inject the chosen dialect into `PiEngine` via constructor (dependency injection)
- Wire `CopilotDialect` permanently into `CopilotEngine` (not configurable — Copilot always uses `.github/prompts/`)
- Wire `NullDialect` permanently into `ClaudeEngine` and `OpenCodeEngine` (SDK resolves natively)
- Remove the dead-code `resolvePrompt` call in `TransitionExecutor.buildTransitionMetadata()` — the UI always shows `sourceText` (the raw `/cmd args`) for slash commands, never the expanded body; the expansion only happens inside each engine's `execute()` method, so the `engineId === "copilot"` check and the entire resolution block are deleted without replacement
- Rename `copilot-prompt-resolver.ts` → `copilot-dialect.ts`; move `collectCopilotCommands` out of `copilot/engine.ts` into `CopilotDialect`
- Apply XML wrapping to both `CopilotEngine` and `PiEngine` (all engines doing manual resolution) — Claude and OpenCode are unaffected since they never see the raw file body

## Capabilities

### New Capabilities
- `slash-command-dialect`: The `SlashCommandDialect` interface, `SlashCommandDialectRegistry`, and concrete implementations (`CopilotDialect`, `ClaudeDialect`, `NullDialect`) that decouple slash-command file conventions from engine implementations

### Modified Capabilities
- `slash-prompt-resolution`: Pi engine now participates in slash resolution; resolved content is XML-wrapped with `<command>` tag for all engines doing manual resolution; Claude dialect adds `.claude/commands/` filesystem lookup path for harness engines
- `slash-command-autocomplete`: Pi engine now returns discoverable commands (when `dialect: copilot` or `dialect: claude` is configured) via `SlashCommandDialect.listCommands()`
- `engine-prompt-resolution`: The `copilot-prompt-resolver.ts` shared library is superseded by the dialect registry; resolution is now dialect-driven with the registry as the single wiring point

## Impact

- **New files**: `dialects/slash-command-dialect.ts`, `dialects/registry.ts`, `dialects/copilot-dialect.ts`, `dialects/claude-dialect.ts`, `dialects/null-dialect.ts`
- **Deleted**: `dialects/copilot-prompt-resolver.ts` (absorbed into `CopilotDialect`)
- **Changed**: `PiEngineConfig` (new `dialect` field), `PiEngine` constructor (dialect injection), `CopilotEngine` (uses `CopilotDialect`), `TransitionExecutor` (removes dead-code resolution block entirely), `engines.yaml.sample` (documents `dialect` option for Pi)
- **Breaking changes**: None — all existing callers unaffected; XML wrapping is additive for the LLM payloads
- **Test impact**: Existing `slash-prompt.test.ts` tests adapt to the new `CopilotDialect` class; new unit tests for `SlashCommandDialectRegistry`, `ClaudeDialect`, and Pi engine integration
