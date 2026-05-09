## Purpose
Defines the `SlashCommandDialect` interface and registry that allow engines to plug in their own slash command discovery and resolution strategy. Replaces the previous shared `copilot-prompt-resolver.ts` free-function with a structured dialect abstraction.

## Requirements

### Requirement: SlashCommandDialect interface defines the contract for slash command resolution
The system SHALL expose a `SlashCommandDialect` interface with two methods: `listCommands(worktreePath, projectPath?)` returning `CommandInfo[]` and `resolvePrompt(value, worktreePath, projectPath?)` returning `Promise<ResolvedPrompt>`. All engines participating in slash command discovery and resolution SHALL implement this interface.

#### Scenario: Interface implemented by CopilotDialect
- **WHEN** `CopilotDialect` is instantiated
- **THEN** it satisfies the `SlashCommandDialect` interface and its `listCommands` scans `.github/prompts/`

#### Scenario: Interface implemented by ClaudeDialect
- **WHEN** `ClaudeDialect` is instantiated
- **THEN** it satisfies the `SlashCommandDialect` interface and its `listCommands` scans `.claude/commands/`

#### Scenario: Interface implemented by NullDialect
- **WHEN** `NullDialect` is instantiated
- **THEN** `listCommands` returns `[]` and `resolvePrompt` returns the input value unchanged with `wasSlash: false`

### Requirement: SlashCommandDialectRegistry maps dialect names to factory functions
The system SHALL provide a `SlashCommandDialectRegistry` class with a `register(name, factory)` method and a `create(name)` method. `register` SHALL return `this` for chaining. `create` SHALL instantiate a new dialect via the registered factory. If `create` is called with an unregistered name, it SHALL throw an error.

#### Scenario: Registered dialect is created by name
- **WHEN** `"copilot"` is registered and `registry.create("copilot")` is called
- **THEN** a new `CopilotDialect` instance is returned

#### Scenario: Unknown dialect name throws error
- **WHEN** `registry.create("unknown-dialect")` is called with no matching registration
- **THEN** an error is thrown with a message that includes the dialect name

#### Scenario: Default registry contains copilot, claude, and none dialects
- **WHEN** `createDefaultDialectRegistry()` is called
- **THEN** the registry can `create("copilot")`, `create("claude")`, and `create("none")` without error

### Requirement: Resolved slash content is XML-wrapped for all manually-resolving engines
When a dialect resolves a slash reference, `resolvePrompt` SHALL return a `ResolvedPrompt` where `content` is the file body wrapped in `<command name="…" args="…">…</command>`, `wasSlash` is `true`, `sourceCommand` is the command stem (e.g. `"gsd-execute-phase"`), and `sourceArgs` is the trailing argument text (empty string when none).

#### Scenario: XML-wrapped output for resolved slash command
- **WHEN** `/gsd-execute-phase my-feature` is resolved and the file body is `Run the executor…`
- **THEN** `content` equals `<command name="gsd-execute-phase" args="my-feature">\nRun the executor…\n</command>`, `wasSlash` is `true`

#### Scenario: ResolvedPrompt for non-slash value
- **WHEN** `resolvePrompt` receives a value that does not start with `/stem`
- **THEN** `content` equals the original value, `wasSlash` is `false`, `sourceCommand` is undefined

### Requirement: PiEngine dialect is configurable via engines.yaml
The system SHALL read an optional `dialect` field from the Pi engine's `engines.yaml` entry. Accepted values SHALL be `"copilot"`, `"claude"`, and `"none"`. When `dialect` is absent, the system SHALL default to `"none"`, yielding a `NullDialect`. The chosen dialect SHALL be injected into `PiEngine` at construction time via `SlashCommandDialectRegistry.create()`.

#### Scenario: Pi engine with dialect copilot discovers .github/prompts commands
- **WHEN** `engines.yaml` has `dialect: copilot` for a Pi entry
- **THEN** `PiEngine.listCommands()` returns commands from `.github/prompts/` and `PiEngine` resolves slash references from that directory

#### Scenario: Pi engine with dialect claude discovers .claude/commands
- **WHEN** `engines.yaml` has `dialect: claude` for a Pi entry
- **THEN** `PiEngine.listCommands()` returns commands from `.claude/commands/` and `PiEngine` resolves slash references from that directory

#### Scenario: Pi engine with no dialect config returns empty command list
- **WHEN** a Pi entry in `engines.yaml` has no `dialect` field
- **THEN** `PiEngine.listCommands()` returns `[]` and slash references are passed through unchanged

### Requirement: Copilot and Claude engines have hardwired, non-configurable dialects
`CopilotEngine` SHALL always use `CopilotDialect` regardless of any `dialect` field on its config. `ClaudeEngine` SHALL always use `NullDialect`. Neither engine SHALL expose a `dialect` config key. This ensures SDK-driven engines cannot accidentally override native resolution.

#### Scenario: CopilotEngine always uses CopilotDialect
- **WHEN** `CopilotEngine` is instantiated
- **THEN** it always uses `CopilotDialect` for listing and resolving, independent of any yaml configuration

#### Scenario: ClaudeEngine always uses NullDialect
- **WHEN** `ClaudeEngine` is instantiated
- **THEN** `listCommands` always delegates to `ClaudeSDK.supportedCommands()` (not CopilotDialect or ClaudeDialect) and `resolvePrompt` returns content unchanged

### Requirement: EngineRegistry exposes dialect lookup by engine ID
The system SHALL provide a `getDialectForEngine(engineId: string): SlashCommandDialect` method on `EngineRegistry`. This method SHALL return the dialect wired to the engine at construction time. Callers (e.g. `TransitionExecutor`) SHALL use this to resolve display text without string-comparing engine IDs.

#### Scenario: Dialect returned for known engine ID
- **WHEN** `engineRegistry.getDialectForEngine("copilot")` is called
- **THEN** a `CopilotDialect` instance is returned

#### Scenario: TransitionExecutor resolves display text via registry
- **WHEN** a transition target engine is `pi-local` with `dialect: copilot`
- **THEN** `TransitionExecutor` calls `getDialectForEngine("pi-local").resolvePrompt(…)` and `wasSlash` drives display text without any `engineId === "copilot"` check
