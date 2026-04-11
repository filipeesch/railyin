## ADDED Requirements

### Requirement: Each engine resolves prompts according to its own convention
The system SHALL delegate prompt resolution to the engine implementation. The orchestrator SHALL pass `prompt` as raw user input in `ExecutionParams` without performing any slash-reference expansion. Each engine SHALL resolve (or pass through) the prompt before sending it to its underlying backend.

#### Scenario: Orchestrator passes raw prompt to engine
- **WHEN** a task execution is triggered with `on_enter_prompt = "/opsx-propose foo"` or a user sends `/opsx-propose foo`
- **THEN** `ExecutionParams.prompt` equals `"/opsx-propose foo"` and no expansion has occurred before the engine receives it

#### Scenario: Native engine resolves prompt using copilot dialect
- **WHEN** Native engine receives `prompt = "/opsx-propose foo"` and `.github/prompts/opsx-propose.prompt.md` exists
- **THEN** Native engine expands the reference before sending to the LLM API

#### Scenario: Copilot engine resolves prompt using copilot dialect
- **WHEN** Copilot engine receives `prompt = "/opsx-propose foo"` and `.github/prompts/opsx-propose.prompt.md` exists
- **THEN** Copilot engine expands the reference before calling `session.send()`

#### Scenario: Claude engine passes prompt raw to the SDK
- **WHEN** Claude engine receives `prompt = "/opsx-propose foo"`
- **THEN** Claude engine passes the string unmodified to the Agent SDK query; the SDK handles resolution via `.claude/commands/` or `.claude/skills/` in the `cwd`

#### Scenario: systemInstructions is always plain text, never resolved
- **WHEN** any engine receives `systemInstructions` in `ExecutionParams`
- **THEN** the value is used as-is without any slash-reference resolution

### Requirement: Copilot dialect resolver is a shared engine-layer library
The copilot prompt resolver SHALL live at `src/bun/engine/dialects/copilot-prompt-resolver.ts` and SHALL be importable by any engine. It SHALL perform the two-step lookup (worktree then `process.cwd()`) and `$input` substitution.

#### Scenario: Native and Copilot engines share the same resolver
- **WHEN** both Native and Copilot engines encounter a slash reference
- **THEN** both call the same `resolvePrompt()` function from `engine/dialects/copilot-prompt-resolver.ts`
