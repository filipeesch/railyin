## Why

The Pi engine (the main target engine) currently benefits from dialect-based slash command and skill resolution, but does not load project instruction files from `.github/instructions/` (Copilot convention) or `.cursor/rules/` (Cursor convention). These instruction files contain critical project-specific guidelines that should be injected into the system prompt. Additionally, the Copilot engine does not scan `.github/instructions/` at the monorepo project root, and the Cursor engine has a bug where project-level skills are silently ignored.

## What Changes

- **New**: Standalone `instruction-scanner` utility module in `engine/dialects/` that provides dialect-agnostic instruction file scanning with frontmatter parsing and autoApply support
- **New**: `getInstructions()` method on `PiDialectResolver` that scans instruction files based on the configured dialect and returns structured `Instruction[]` array
- **New**: Pi engine injects instruction blocks into the system prompt via `enrichedSystem` construction
- **New**: Copilot engine resolves projectPath from DB and scans `.github/instructions/` at both project root and worktree, injecting via `systemMessage: { mode: "append" }`
- **Fix**: Cursor engine passes `projectPath` to `getSkillPaths()` to resolve project-level skills (currently only scans worktree)
- **Convention mapping**: Scanner uses dialect-aware convention mapping (copilot → `.github/instructions/*.md`, cursor → `.cursor/rules/*.mdc`)
- **Frontmatter parsing**: Extracts `description` and `autoApply` fields from YAML frontmatter; files without frontmatter are silently skipped
- **autoApply support**: When `autoApply: true`, full file content is injected; otherwise only frontmatter is included
- **Structured logging**: JSON log lines emitted when instruction files are loaded

## Capabilities

### New Capabilities
- `instruction-scanner`: Dialect-agnostic utility for scanning instruction files, parsing YAML frontmatter, extracting description/autoApply fields, and returning structured Instruction[] array. Supports both Copilot (`.github/instructions/*.md`) and Cursor (`.cursor/rules/*.mdc`) conventions.

### Modified Capabilities
- `cursor-dialect`: Cursor engine fixes getSkillPaths() bug to pass projectPath, enabling project-level skill loading in monorepo setups
- `copilot-engine`: Copilot engine adds projectPath resolution from DB and `.github/instructions/` scanning with system prompt injection
- `pi-engine`: Pi engine adds `getInstructions()` to PiDialectResolver and injects instruction blocks into the system prompt based on dialect config

## Impact

- **New file**: `src/bun/engine/dialects/instruction-scanner.ts` (standalone utility)
- **Modified**: `src/bun/engine/pi/dialect-resolver.ts` (new method)
- **Modified**: `src/bun/engine/pi/engine.ts` (instruction injection)
- **Modified**: `src/bun/engine/copilot/engine.ts` (projectPath resolution + instruction scanning)
- **Modified**: `src/bun/engine/cursor/engine.ts` (getSkillPaths bug fix)
- **No interface changes**: `SlashCommandDialect` interface remains unchanged
- **No SDK dependency changes**: Uses existing SDK features (Cursor settingSources, Copilot systemMessage)
- **No breaking changes**: All changes are additive or bug fixes
