## Why

The Cursor engine is wired to `CursorDialect` (constructor default, registry, executor-layer `SlashCommandResolver`), but the dialect's lookup scope and the engine's skill delivery make the agent blind to the dialect artifacts that actually exist:

- The user's 119 skills live in `~/.cursor/skills/` (Cursor's user-level location), but `CursorDialect.getSkillPaths()` deliberately excludes home scope — the Cursor engine injects **zero** skills.
- The repo's commands live in `.github/prompts/*.prompt.md` (Copilot convention), but `CursorDialect` only scans `.cursor/commands/*.md` — slash autocomplete is empty.
- Worse, `CursorDialect.resolvePrompt()` **throws** on any unresolved `/cmd` (no pass-through carve-out like `CopilotDialect`), so typing a slash reference in a Cursor conversation fails the entire send.
- `CursorEngine._run()` computes the DB worktree path and then ignores it, calling `getSkillPaths(workingDirectory, projectPath)` — inconsistent with `listCommands()`, which uses the DB-derived path.

## What Changes

- **NEW**: `CursorDialect` home scope — commands and skills are scanned at `<projectPath>/.cursor/*` → `<worktreePath>/.cursor/*` → `~/.cursor/*`, mirroring `CopilotDialect` (`.github`) and `ClaudeDialect` (`.claude`). Project wins on name collisions; home scope is the lowest-priority fallback.
- **FIX**: `SlashCommandResolver` fail-soft policy — an unresolved slash reference is passed through unchanged (with a console warning) instead of throwing, at the single shared choke point used by Copilot/Cursor/Pi executors.
- **CHANGE**: Cursor skill delivery switches from "prepend every `SKILL.md` into the prompt prefix" to the Pi pattern: a compact `<available_skills>` index (name + description) in the prefix plus a lazy `skill` `SDKCustomTool` that loads a `SKILL.md` on demand. This makes the 119 home skills usable without token blowup.
- **FIX**: `CursorEngine._run()` uses the DB-derived `worktreePath` for `getSkillPaths()` (fallback `workingDirectory`), consistent with `listCommands()`; the duplicated task→path DB lookup is extracted into one helper used by both.
- **CLEANUP**: remove the dead `CursorSdkAdapter.listCommands()` no-op stub; verify and remove unused `PiDialectResolver.resolvePrompt()` if confirmed dead.
- **UPGRADE**: `@cursor/sdk` lockfile refreshed to the latest stable `1.0.27` (currently pinned at `1.0.25`). The declared `^1.0.25` range already permits `1.0.27`, so this is a lockfile refresh plus regression verification against the engine's existing 1.0.x API surface — not a breaking migration.

## Capabilities

### Modified Capabilities
- `cursor-dialect`: home-scope command discovery and skill paths (`~/.cursor/commands`, `~/.cursor/skills`); lookup order project → worktree → home
- `cursor-sdk`: lazy `skill` tool + `<available_skills>` listing replacing wholesale `SKILL.md` prepend; consistent DB-derived worktree path in `_run()`; slash references resolved upstream with fail-soft pass-through
- `slash-command-dialect`: fail-soft resolution policy at the shared `SlashCommandResolver` (unresolved slash refs pass through with a warning)

## Impact

- **Files changed**: `src/bun/engine/dialects/cursor-dialect.ts`, `src/bun/engine/execution/slash-command-resolver.ts`, `src/bun/engine/cursor/engine.ts`, `src/bun/engine/cursor/tools.ts`, `src/bun/engine/pi/skill-resolver.ts` (small extension), `src/bun/engine/cursor/adapter.ts` (interface cleanup)
- **No API or schema changes** — purely engine-internal behavior
- **No breaking changes** — additive behavior + one error-path relaxation (throw → pass-through)
- **Dependencies**: `@cursor/sdk` `1.0.27` (bun.lock refresh; API surface unchanged — `Agent.create`/`Agent.resume`, `Cursor.configure`, `AgentBusyError`, `SDKCustomTool`)
- **Documented follow-ups (not implemented here)**: Copilot engine `.github/skills/` injection parity; Pi engine default dialect; full `worktreePath` vs `workingDirectory` semantic cleanup across executors; OpenSpec spec refresh
