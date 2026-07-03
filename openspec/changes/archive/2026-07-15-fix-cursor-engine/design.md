## Context

The Cursor engine (`src/bun/engine/cursor/`) was added as a third non-native engine alongside Copilot and Pi. The SDK runs in a Node.js subprocess (`worker.mjs`) due to a Bun HTTP/2 bug, with all IPC over line-delimited JSON on stdio.

Every other engine in the system has a `SlashCommandDialect` for command discovery and resolution, injects skills into context, and handles edge-case SDK errors. The Cursor engine was shipped without these — making it silently non-functional for slash-command workflows, and broken when a `decision_request` is followed by a user reply.

**Current state:**
- `CursorEngine.listCommands()` always returns `[]`; ignores worktree path
- Slash references like `/create-or-update-pr` are sent raw to the SDK, never expanded
- `.cursor/skills/` content is never injected into the agent context
- `.cursorrules` / `.cursor/rules/*.mdc` are never loaded (no `settingSources`)
- `AgentBusyError` after a `decision_request`-triggered abort causes the agent to get stuck permanently

## Goals / Non-Goals

**Goals:**
- Full slash-command support for Cursor engine (`.cursor/commands/*.md`, recursive colon-namespaced subdirs)
- Skill file injection into system prompt prefix (`.cursor/skills/<name>/SKILL.md`)
- Native Cursor project rules loading (`settingSources: ["project"]`)
- `AgentBusyError` recovery after `decision_request` abort cycle
- Correct `listCommands()` path resolution from DB (worktree + project path)

**Non-Goals:**
- Disabling Cursor's built-in tools (SDK provides no knob for this)
- User-scope rules (`settingSources: ["user"]`) — project scope only for predictability
- Home-scope commands (`~/.cursor/commands/`) — Cursor is project-scoped by convention
- `worker.mjs` / `events.ts` deduplication (noted as cleanup, deferred)

## Decisions

### D1 — New `CursorDialect` class (mirrors `ClaudeDialect`, not `CopilotDialect`)
Cursor uses its own project folder conventions — distinct from both Copilot's `.github/prompts/` and Claude's `.claude/commands/`:

- `listCommands()`: scans `<projectPath>/.cursor/commands/` and `<worktreePath>/.cursor/commands/` recursively; subdirs are colon-namespaced (`shared/cmd.md` → `shared:cmd`); plain `.md` extension; **no home scope**
- `resolvePrompt()`: colon → slash subdir mapping + `$input` substitution + XML-wrapping (frontmatter preserved, not stripped — same as `ClaudeDialect`)
- `getSkillPaths()`: returns existing `<projectPath>/.cursor/skills/` and `<worktreePath>/.cursor/skills/`; each skill is a named directory with `SKILL.md` inside (same structure as `.github/skills/`)

`CursorDialect` is structurally closest to `ClaudeDialect`:
- Both use `.md` (not `.prompt.md`)
- Both support recursive colon-namespaced subdirectories
- Both use `commandName.replaceAll(":", "/") + ".md"` for resolution
- Only differences: folder root (`.cursor/` vs `.claude/`), no home scope, `getSkillPaths()` returns `.cursor/skills/` (ClaudeDialect returns `[]`)

**Alternative considered**: Mirror `CopilotDialect` exactly (`.github/prompts/*.prompt.md`). Rejected — real Cursor projects use `.cursor/commands/*.md` with subdirectory namespacing.

**Alternative considered**: Reuse `ClaudeDialect` with a different root. Rejected — keeping a dedicated class lets Cursor-specific behavior (skills, no home scope) stay explicit and separately testable.

### D2 — Skills injected into `systemInstructions` prefix (not per-turn prompt)
The Cursor SDK has no dedicated system-message slot. Skills are prepended to the `systemInstructions` string that is already built into the prompt prefix in `_run()`. This is consistent with how `taskContext` and `workflow_instructions` are handled.

`getSkillPaths()` returns `.cursor/skills/` directories; each named subdirectory's `SKILL.md` is read and concatenated with the directory name as a header. Content is prepended before `systemBlock` in the prefix chain.

**Alternative considered**: Inject per-turn as part of the user prompt. Rejected because skills are context for every turn, not user input; the prefix position is semantically correct.

### D3 — `AgentBusyError` retry in `worker.mjs` with `{ local: { force: true } }`
**Root cause**: After a `decision_request`, `decisionAbort.abort()` fires → `cancelRun` is sent to the worker → the worker sets `state.aborted = true` and calls `run.cancel()` (fire-and-forget, not awaited) → `runDone` is immediately sent back → Bun marks execution as `waiting_user` → worker `finally` calls `agent.close()` synchronously. If the next turn's `startRun` arrives before `run.cancel()` has committed `"cancelled"` to the SDK's SQLite store, `agent.send()` throws `AgentBusyError`.

**Fix location**: `worker.mjs` `handleStartRun()`, wrapping `agent.send(prompt)`:

```js
try {
  state.run = await state.agent.send(prompt);
} catch (err) {
  if (err instanceof AgentBusyError) {
    // Prior run not yet committed as cancelled (decision_request race).
    // force:true expires the stale persisted run atomically.
    state.run = await state.agent.send(prompt, { local: { force: true } });
  } else {
    throw err;
  }
}
```

The SDK documents `force: true` as the exact recovery path for "wedged agents after a crashed CLI process". It expires the active persisted run before starting the new one.

**Alternative considered**: Await `run.cancel()` before sending `runDone`. Rejected because `run.cancel()` can hang on network I/O and the current fire-and-forget ensures the Bun side sees `runDone` quickly. `force: true` is a cleaner single-point fix.

### D4 — `settingSources: ["project"]` always on
Project-scope rules are the primary use case for `.cursorrules` / `.cursor/rules/*.mdc`. They are always desirable and their absence is always a bug. User-scope (`"user"`) is excluded: it reads `~/.cursor/` which varies per machine and can conflict with project rules in unpredictable ways.

### D5 — `listCommands()` DB lookup mirrors `CopilotEngine.listCommands()`
Exact copy of the pattern: `task_git_context.worktree_path` for the worktree, `getLoadedProjectByKey(wsKey, project_key)?.projectPath` for the project path. Uses dynamic import of `getDb`, `getDefaultWorkspaceKey`, `getLoadedProjectByKey` to avoid circular dependency issues (same as Copilot).

## Risks / Trade-offs

**[Risk] Skill file injection increases prompt token count** → Accepted trade-off. Skills are bounded by the number of `SKILL.md` files in `.cursor/skills/`. Mirrors how other engines handle it.

**[Risk] `force: true` silently cancels a legitimately parallel run** → Not applicable in Railyin's model: one execution per conversation at a time. There is never a legitimate concurrent run for the same agent.

**[Risk] `settingSources: ["project"]` loads rules that conflict with system instructions** → Rules are user-controlled project artifacts; conflicts are user responsibility, same as in the Cursor editor itself.

**[Risk] `CursorDialect` drifts from `ClaudeDialect`** → Low risk. The `.cursor/` folder convention is stable. Having a separate class makes any future Cursor-specific behaviour explicit.

## Migration Plan

No data migration. No API changes. Changes are internal to the engine layer:

1. Create `src/bun/engine/dialects/cursor-dialect.ts`
2. Update `src/bun/engine/cursor/engine.ts`
3. Update `src/bun/engine/cursor/worker.mjs`

Rollback: revert the three files. No state is persisted by the new code.

## Open Questions

None — all decisions are resolved.
