## MODIFIED Requirements

### Requirement: Each engine resolves prompts according to its own convention
The system SHALL delegate prompt resolution to the engine implementation via its injected `SlashCommandDialect`. The orchestrator SHALL pass `prompt` as raw user input in `ExecutionParams` without performing any slash-reference expansion. Each engine SHALL call `dialect.resolvePrompt()` before sending to its underlying backend and use the returned `ResolvedPrompt.content`.

#### Scenario: Orchestrator passes raw prompt to engine
- **WHEN** a task execution is triggered with `on_enter_prompt = "/opsx-propose foo"` or a user sends `/opsx-propose foo`
- **THEN** `ExecutionParams.prompt` equals `"/opsx-propose foo"` and no expansion has occurred before the engine receives it

#### Scenario: Copilot engine resolves prompt using CopilotDialect
- **WHEN** Copilot engine receives `prompt = "/opsx-propose foo"` and `.github/prompts/opsx-propose.prompt.md` exists
- **THEN** Copilot engine calls `copilotDialect.resolvePrompt(…)` and sends `ResolvedPrompt.content` (XML-wrapped) to `session.send()`

#### Scenario: Pi engine with CopilotDialect resolves prompt
- **WHEN** Pi engine (dialect: copilot) receives `prompt = "/opsx-propose foo"` and the file exists
- **THEN** Pi engine calls `dialect.resolvePrompt(…)` and sends XML-wrapped content to the LLM

#### Scenario: Pi engine with NullDialect passes prompt raw
- **WHEN** Pi engine (no dialect) receives `prompt = "/opsx-propose foo"`
- **THEN** Pi engine calls `dialect.resolvePrompt(…)` which returns the original string unchanged

#### Scenario: Claude engine passes prompt raw to the SDK
- **WHEN** Claude engine receives `prompt = "/opsx-propose foo"`
- **THEN** Claude engine passes the string unmodified to the Agent SDK query; the SDK handles resolution via `.claude/commands/` or `.claude/skills/` in the `cwd`

#### Scenario: systemInstructions is always plain text, never resolved
- **WHEN** any engine receives `systemInstructions` in `ExecutionParams`
- **THEN** the value is used as-is without any slash-reference resolution

### Requirement: TransitionExecutor resolves display text via dialect registry without engine-type string checks
The system SHALL not contain any string comparison of engine IDs (e.g. `engineId === "copilot"`) to decide whether to perform slash resolution for display purposes. `TransitionExecutor` SHALL call `engineRegistry.getDialectForEngine(targetEngineId).resolvePrompt(value, worktreePath)` and use `ResolvedPrompt.wasSlash` to determine whether the original slash token or the full resolved body should be shown as the instruction detail.

#### Scenario: TransitionExecutor shows original slash token as instruction detail
- **WHEN** a transition's `on_enter_prompt` resolves to `wasSlash: true`
- **THEN** `instructionDetail` is set to the original `/command-name` text, not the full resolved body

#### Scenario: TransitionExecutor uses resolved content for non-Copilot engines with a dialect
- **WHEN** a Pi engine task transitions with `on_enter_prompt = "/my-cmd"` and the Pi engine has `dialect: copilot`
- **THEN** `TransitionExecutor` resolves via the Pi engine's `CopilotDialect` and `wasSlash: true` drives display text correctly

## REMOVED Requirements

### Requirement: Copilot dialect resolver is a shared engine-layer library
**Reason**: Superseded by `SlashCommandDialect` interface and `SlashCommandDialectRegistry`. The shared free-function pattern (`resolvePrompt()` from `copilot-prompt-resolver.ts`) is replaced by dialect instances obtained from the registry.
**Migration**: All engine-layer resolution now goes through `dialect.resolvePrompt()`. `TransitionExecutor` uses `engineRegistry.getDialectForEngine(id)` to obtain the dialect; no imports from `copilot-prompt-resolver.ts` are needed.
