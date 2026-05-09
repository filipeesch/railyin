## Context

Railyin supports multiple AI execution engines (Copilot, Claude, OpenCode, Pi). Copilot engine has a working slash-command pipeline: it scans `.github/prompts/*.prompt.md` for command discovery and resolves `/stem arg` references before sending to the LLM. This logic lives in `src/bun/engine/dialects/copilot-prompt-resolver.ts` and `CopilotEngine`.

Pi engine, a harness-style engine with full prompt control, currently returns `[]` from `listCommands()` and passes prompts raw — slash commands do not work for Pi at all.

Additionally, `TransitionExecutor.buildTransitionMetadata()` contains a hardcoded `engineId === "copilot"` string check to decide whether to resolve display text. This is a violation of Open/Closed and will break for any future engine that supports slash resolution.

The goal is to replace the ad-hoc resolver with a proper `SlashCommandDialect` abstraction: an interface + registry that decouples the file-convention logic from engine implementations.

## Goals / Non-Goals

**Goals:**
- Pi engine participates in slash-command discovery and resolution via a configurable dialect
- `SlashCommandDialect` interface and registry are extensible without modifying existing engine or registry code
- `TransitionExecutor` hardcoded engine-type check is removed
- `copilot-prompt-resolver.ts` is refactored into `CopilotDialect` class; `collectCopilotCommands` moves with it
- Resolved content from any manually-resolving engine is XML-wrapped: `<command name="…" args="…">…</command>` to give the LLM identity context
- `ClaudeDialect` added for harness engines that want to follow `.claude/commands/` convention

**Non-Goals:**
- Changing how Claude or OpenCode engines resolve prompts (SDK handles natively)
- Making Copilot or Claude engines' dialect configurable (they are hardwired)
- Filesystem watching or hot-reloading of command files
- Subdirectory scanning within Copilot's `.github/prompts/` (flat only — Copilot convention uses flat filenames like `opsx-apply.prompt.md`)

## Decisions

### D1: `SlashCommandDialect` interface with `SlashCommandDialectRegistry`

A registry maps dialect name strings to factory functions. New dialects register themselves without touching existing code.

```ts
// dialects/slash-command-dialect.ts
export interface SlashCommandDialect {
  listCommands(worktreePath: string, projectPath?: string): CommandInfo[];
  resolvePrompt(value: string, worktreePath: string, projectPath?: string): Promise<ResolvedPrompt>;
}

export interface ResolvedPrompt {
  content: string;          // bare body or XML-wrapped if wasSlash=true
  wasSlash: boolean;
  sourceCommand?: string;   // "/gsd-execute-phase"
  sourceArgs?: string;      // "my-feature"
}
```

```ts
// dialects/registry.ts
export class SlashCommandDialectRegistry {
  private readonly factories = new Map<string, () => SlashCommandDialect>();

  register(name: string, factory: () => SlashCommandDialect): this {
    this.factories.set(name, factory);
    return this;
  }

  create(dialectName: string): SlashCommandDialect {
    const factory = this.factories.get(dialectName);
    if (!factory) throw new Error(`Unknown slash command dialect: "${dialectName}"`);
    return factory();
  }
}

export function createDefaultDialectRegistry(): SlashCommandDialectRegistry {
  return new SlashCommandDialectRegistry()
    .register("copilot", () => new CopilotDialect())
    .register("claude",  () => new ClaudeDialect())
    .register("none",    () => new NullDialect());
}
```

**Alternative considered:** Factory function with if/else chain. Rejected — OCP violation; every new dialect modifies the factory.

**Alternative considered:** Engine carries its own static dialect type (enum on `EngineConfig`). Rejected — merges engine identity with file-convention concept; doesn't support Pi using Claude's convention.

### D2: Dialect is configurable only on harness engines (Pi); SDK engines are hardwired

Copilot engine always uses `CopilotDialect`. Claude and OpenCode always use `NullDialect` (their SDKs handle resolution natively and cannot be overridden by Railyin). Pi and any future harness engine receive an injected `SlashCommandDialect` via constructor, driven by the `dialect` field in their `engines.yaml` config entry.

```yaml
- id: pi-local
  type: pi
  dialect: copilot   # opt-in; default "none" → NullDialect
```

**Why Pi default is `none`:** Explicit opt-in avoids surprising users who don't expect slash expansion. Unlike Copilot (always `.github/prompts/`), Pi's dialect is a user choice.

### D3: XML wrapping for all engines doing manual resolution

When `wasSlash=true`, `CopilotDialect` and `ClaudeDialect` wrap resolved content:

```xml
<command name="gsd-execute-phase" args="my-feature">
...file body with $input substituted...
</command>
```

Rationale: the LLM gains self-awareness of which named command it is executing, enabling better adherence to the command's documented intent. Applied uniformly to all manually-resolving engines (Copilot, Pi). Claude/OpenCode unaffected — SDK handles them.

**Risk:** XML tags in the prompt body may confuse local LLMs. Mitigation: well-formed XML is widely supported; the outer tag is minimal and positioned before the body content.

### D4: `TransitionExecutor` removes dead-code resolution block

Investigation revealed that `getTransitionInstructionText()` in the frontend always returns `sourceText` (the raw `/cmd args`) when `sourceKind === "slash"` — the `displayText` field is only used for inline instructions. This means the `engineId === "copilot"` check in `buildTransitionMetadata()` and the `resolvePrompt()` call that populates `displayText` are dead code for slash commands.

The fix is a pure deletion: remove the `engineId === "copilot"` branch and always assign `displayText = prompt` (the raw string). `EngineRegistry.getDialectForEngine()` is **not needed** — `TransitionExecutor` becomes fully dialect-unaware. Expansion only happens inside each engine's `execute()` method.

This also means `EngineRegistry` does not need a `getDialectForEngine()` method. Each engine owns its dialect; the registry manages engines, not dialects.

### D5: `CopilotDialect` absorbs `copilot-prompt-resolver.ts`

The existing resolver file is not renamed — it is deleted. `CopilotDialect` re-implements the same logic as a class method. `collectCopilotCommands` moves from `copilot/engine.ts` into `CopilotDialect.listCommands()`. This removes a misleadingly-named public function and a file that implied Copilot ownership of a generic capability.

### D6: `ClaudeDialect` scans `.claude/commands/*.md` with subdirectory support

Lookup order mirrors `CopilotDialect` but for Claude's convention:
1. `<worktreePath>/.claude/commands/`
2. `<projectPath>/.claude/commands/` (if differs)
3. `~/.claude/commands/`

**Subdirectory colon-namespacing:** Claude commands may live in nested directories. The directory path is collapsed to a colon-separated name — `commands/opsx/apply.md` → `opsx:apply`. Resolution reverses this: `/opsx:apply` → `opsx/apply` → `<base>/opsx/apply.md`.

**No frontmatter stripping:** `.claude/commands/` files use frontmatter for the `description:` field (read by `listCommands()` for autocomplete), but the full file body including the `---` block is sent to the LLM unchanged.

**`parseFrontmatterDescription` parity:** `listCommands()` extracts the `description:` field from YAML frontmatter to populate `CommandInfo.description` — matching what the Claude SDK returns from `sdkAdapter.listCommands()`.

Used only by Pi (or future harness engines). Claude engine itself stays `NullDialect`.

## Risks / Trade-offs

- **[Risk] XML wrapping in Copilot is a behavioral change** → The LLM now sees `<command>` tags it didn't before. Copilot/GPT-4.1 handles XML well; local LLMs (Pi) also generally handle it. Low risk, but worth monitoring if Copilot users report regressions.
- **[Risk] `copilot-prompt-resolver.ts` deletion breaks any external importers** → Search confirms only two callers: `CopilotEngine` and `TransitionExecutor`. Both are migrated as part of this change. No external risk.
- **[Trade-off] Pi default is `none`** → Users must explicitly configure `dialect: copilot` in `engines.yaml`. This is intentional (opt-in > surprise) but means Pi slash commands don't work "out of the box".

## Migration Plan

1. Create new dialect files (`slash-command-dialect.ts`, `registry.ts`, `copilot-dialect.ts`, `claude-dialect.ts`, `null-dialect.ts`)
2. Wire `SlashCommandDialectRegistry` creation in `EngineRegistry` constructor
3. Migrate `CopilotEngine` to use `CopilotDialect` (XML wrap is included)
4. Add `dialect` field to `PiEngineConfig`; inject dialect into `PiEngine` constructor
5. Migrate `TransitionExecutor` to use `registry.getDialectForEngine()` — removes `engineId === "copilot"` check
6. Delete `copilot-prompt-resolver.ts`; update `slash-prompt.test.ts` to import from `CopilotDialect`
7. Update `engines.yaml.sample` with `dialect:` documentation for Pi entries

No data migrations required. No API changes. Rollback: revert commit.

## Open Questions

- Should `ClaudeDialect` also strip frontmatter from `.md` files (`.claude/commands/` files don't use YAML frontmatter conventionally)? Likely no — keep it simple unless a real-world case demands it.
