## 1. CursorDialect — home scope

- [ ] 1.1 `src/bun/engine/dialects/cursor-dialect.ts` — `listCommands()`: append `~/.cursor/commands` scan after project/worktree (dedup first-wins, project > worktree > home)
- [ ] 1.2 `resolvePrompt()`: append `join(homedir(), ".cursor", "commands")` to `candidateDirs` (mirrors `ClaudeDialect` ordering)
- [ ] 1.3 `getSkillPaths()`: append `~/.cursor/skills` (filtered by `existsSync`)
- [ ] 1.4 Update class docstring with the 3-level lookup order (project → worktree → home)

## 2. SlashCommandResolver — fail-soft policy

- [ ] 2.1 `src/bun/engine/execution/slash-command-resolver.ts` — wrap `dialect.resolvePrompt()` in try/catch; on error `console.warn` (engine id, dialect, prompt snippet) and return the raw prompt unchanged

## 3. Skill resolver — description listing

- [ ] 3.1 `src/bun/engine/pi/skill-resolver.ts` — add `listWithDescriptions(): Promise<Array<{ name: string; description?: string }>>` to `FileSystemSkillResolver` (parses `description:` from each `SKILL.md` frontmatter); leave the `SkillResolver` interface unchanged

## 4. Cursor engine — lazy skill tool + listing

- [ ] 4.1 `src/bun/engine/cursor/tools.ts` — `buildCursorTools(context, skillResolver?, onSuspend?)`: register a `skill` `SDKCustomTool` (`{ name: string }` schema) resolving SKILL.md content via the resolver; on miss, return available names + fuzzy suggestion (mirrors `pi/tools/skill.ts`); no skill tool when resolver is undefined
- [ ] 4.2 `src/bun/engine/cursor/engine.ts` — extract the task→`{worktreePath, projectPath}` DB lookup into a shared private helper (dynamic imports preserved), used by both `_run()` and `listCommands()`
- [ ] 4.3 `_run()` — reorder: resolve task paths → build `FileSystemSkillResolver` from `dialect.getSkillPaths(worktreePath, projectPath)` (DB-derived worktree path) → build tools (with resolver) → compose prefix
- [ ] 4.4 `_run()` — replace the wholesale `skillsBlock` prepend with a bounded `## Available Skills` + `<available_skills>` listing (name + truncated frontmatter description); omit when empty
- [ ] 4.5 Remove the now-dead `readdirSync`/`readFileSync` skill-prepend loop and its imports

## 5. Cleanup

- [ ] 5.1 `src/bun/engine/cursor/adapter.ts` + `inprocess-adapter.ts` — remove the dead `CursorSdkAdapter.listCommands()` no-op stub from the interface and implementation
- [ ] 5.2 Verify `PiDialectResolver.resolvePrompt()` has no production callers; remove if confirmed dead

## 6. Tests (deferred — tackled later per user instruction)

- [ ] 6.1 Unit: `CursorDialect` home-scope listCommands/resolvePrompt/getSkillPaths (mirror `copilot-dialect.test.ts` home-scope cases)
- [ ] 6.2 Unit: `SlashCommandResolver` fail-soft pass-through + warning
- [ ] 6.3 Unit: `FileSystemSkillResolver.listWithDescriptions()`
- [ ] 6.4 Engine: `_run()` registers `skill` tool; listing block replaces prepend; DB worktree path passed to `getSkillPaths` (extend `cursor/engine.test.ts`)
- [ ] 6.5 RPC: unresolved `/cmd` in Cursor chat sends successfully with raw text (extend `cursor/rpc-scenarios.test.ts`)
