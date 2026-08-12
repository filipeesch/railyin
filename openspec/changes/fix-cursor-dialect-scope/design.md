## Context

The Cursor engine (`src/bun/engine/cursor/`) runs `@cursor/sdk` in-process and is the third dialect-driven engine alongside Copilot and Pi. Investigation (task/647) confirmed the engine **is** wired to `CursorDialect` everywhere: constructor default, `createDefaultDialectRegistry()`, and the executor-layer `SlashCommandResolver` (chat/transition/retry/human-turn). Skills were prepended into the prompt prefix, and `.cursor/rules/*.mdc` load natively via `settingSources: ["project"]`.

The remaining failures are **scope/convention mismatches**, not missing wiring:

- `CursorDialect.getSkillPaths()` deliberately excludes home scope (decision D1 of the earlier `fix-cursor-engine` change: "Cursor skills are project-scoped by convention"). The user's real skills live in `~/.cursor/skills/` (119 entries, symlinked from `~/.agents/skills/`) — invisible to the engine.
- The repo's commands live in `.github/prompts/*.prompt.md` (Copilot convention). `CursorDialect` scans only `.cursor/commands/*.md` → autocomplete empty; `resolvePrompt()` throws on any unresolved `/cmd` → the whole send fails.
- `CursorEngine._run()` computes `worktreePath` from the DB and then calls `getSkillPaths(workingDirectory, projectPath)` with the raw param — dead code + inconsistent with `listCommands()`.
- `CopilotDialect` and `ClaudeDialect` both include home scope (`~/.github/prompts`, `~/.claude/commands`); `CursorDialect` is the odd one out.

## Goals / Non-Goals

**Goals:**
- `CursorDialect` discovers commands and skills at project → worktree → home scope (`~/.cursor/*`), matching Copilot/Claude dialect parity
- Unresolved slash references pass through with a warning instead of failing the send, at the shared resolver level (benefits Copilot/Cursor/Pi uniformly)
- Cursor agents get skills via a lazy `skill` tool + compact `<available_skills>` listing (Pi pattern), replacing wholesale `SKILL.md` prepend — making the 119 home skills usable without token blowup
- `CursorEngine._run()` resolves paths from the DB consistently with `listCommands()` (single shared helper)

**Non-Goals:**
- Copilot engine `.github/skills/` injection parity (documented follow-up)
- Pi engine default dialect change (documented follow-up)
- Full `worktreePath` vs `workingDirectory` semantic cleanup across all executors/dialects (documented follow-up)
- OpenSpec spec refresh for stale capabilities (documented follow-up)
- Test suite expansion (deferred per user instruction — tackled later)

## Decisions

### D1 — `CursorDialect` gains home scope, mirroring Copilot/Claude dialects
`listCommands()`, `resolvePrompt()` candidate dirs, and `getSkillPaths()` append `~/.cursor/commands` / `~/.cursor/skills` as the lowest-priority fallback after project and worktree scopes. Deduplication stays first-occurrence-wins (project > worktree > home). This matches the lookup order already implemented by `CopilotDialect` and `ClaudeDialect` and reflects Cursor IDE behavior (user-level commands and skills at `~/.cursor/`).

**Alternative considered**: keep project-scoped only (status quo). Rejected — the reported "not finding skills" symptom is exactly the home-scope exclusion, and Cursor IDE itself supports `~/.cursor/commands` + `~/.cursor/skills`.

### D2 — Cursor skills move to a lazy `skill` tool + `<available_skills>` listing (Pi pattern)
Replace the current "read every `SKILL.md` and prepend to the prompt prefix" with:

1. `dialect.getSkillPaths(worktreePath, projectPath)` (now incl. home) → build a `FileSystemSkillResolver`
2. Register a `skill` `SDKCustomTool` (schema `{ name }`) that resolves and returns the `SKILL.md` content on demand; on a miss it lists available names with a fuzzy suggestion (mirrors `src/bun/engine/pi/tools/skill.ts`)
3. Inject a compact `## Available Skills` + `<available_skills>` block (name + one-line `description:` from frontmatter, truncated ~200 chars) into the prompt prefix so the agent knows what exists without loading content

**Why**: prepending 119 home skills per run is not viable (tokens). Pi already proves the lazy pattern; the Cursor engine can register the tool via its existing `SDKCustomTool` mechanism (`buildCursorTools`).

**Alternative considered**: prepend project skills + home via tool only. Rejected for a single coherent mechanism (one way skills work, regardless of scope).

### D3 — Fail-soft slash resolution at the shared `SlashCommandResolver`
`SlashCommandResolver.resolve()` wraps `dialect.resolvePrompt()` in a try/catch: on error it logs a warning (engine, dialect, prompt snippet) and returns the raw prompt unchanged. Dialects keep their pure contract (throw on missing file); the resolver owns the resilience policy. This is the single choke point for Copilot/Cursor/Pi executor resolution — one change, uniform behavior. Claude/OpenCode never reach it (native SDK handling).

**Alternative considered**: change each dialect to return pass-through. Rejected — duplicates policy across dialects; the resolver is the correct orchestration layer (single responsibility).

### D4 — `CursorEngine._run()` path consistency + shared helper
`_run()` uses the DB-derived `worktreePath` (`task_git_context.worktree_path`, fallback `workingDirectory`) for `getSkillPaths()`, matching `listCommands()`. The duplicated task→`{worktreePath, projectPath}` DB lookup (currently copy-pasted in `_run()` and `listCommands()`) is extracted into a single private helper (dynamic imports preserved to avoid circular deps). This removes ~30 duplicated lines and guarantees the two call sites can never drift again.

### D5 — `FileSystemSkillResolver` gains `listWithDescriptions()`
Add an optional method to `FileSystemSkillResolver` (not the `SkillResolver` interface, keeping Pi untouched) that returns `Array<{ name, description }>` by reading each skill dir's `SKILL.md` frontmatter `description:`. The Cursor engine uses it to build the bounded `<available_skills>` listing. Symlinked home skills (`~/.cursor/skills/*` → `.agents/skills/*`) resolve transparently via `existsSync`/`readFileSync`.

### D6 — Dead-code cleanup
- Remove `CursorSdkAdapter.listCommands()` + its no-op `InProcessCursorAdapter` stub — the engine lists commands via the dialect, never the adapter.
- Verify `PiDialectResolver.resolvePrompt()` has no production callers (executor resolves upstream); remove if confirmed dead.

## Risks / Trade-offs

**[Risk] Home-scope skills/commands surface in every Cursor task** → Accepted per D1; dedup keeps project/worktree precedence. Skills are lazy-loaded (D2), so only the bounded listing (~10–20 KB for 119 skills) enters the prompt.

**[Risk] Fail-soft hides genuine slash typos** → The agent receives the raw `/cmd` as literal text with a server-side warning. Matches Claude/OpenCode native-engine resilience; hard I/O errors still propagate (only resolution failures are caught).

**[Risk] Listing block grows with skill count** → Bounded by truncating descriptions (~200 chars) and, if needed later, a cap on listed entries; content itself is never inlined.

**[Risk] `_run()` reordering (paths → resolver → tools → prefix) changes tool/prefix construction order** → Pure internal sequencing; no observable contract change. Covered by existing engine tests (SpyDialect pattern) and RPC scenarios; full test strategy deferred.

## Migration Plan

No data migration. No API changes. Changes are internal to the engine/dialect layer:

1. Extend `CursorDialect` (home scope)
2. Add fail-soft to `SlashCommandResolver`
3. Extend `FileSystemSkillResolver` (`listWithDescriptions`)
4. Add `skill` tool to `buildCursorTools`; reorder `_run()`; replace prepend with listing
5. Cleanup dead adapter/listCommands and dead `PiDialectResolver.resolvePrompt`

Rollback: revert the touched files. No persisted state is affected.

## Open Questions

None — all design decisions are resolved.
