## Why

The Cursor engine is missing three key capabilities that every other engine has — slash-command resolution, skill/rules loading, and graceful recovery from a known SDK race condition — making it unreliable and incomplete as an execution backend.

## What Changes

- **NEW**: `CursorDialect` — implements `SlashCommandDialect` using the `.github/prompts/*.prompt.md` and `.github/skills/` conventions (same as Copilot/Pi engines)
- **FIX**: `CursorEngine.listCommands()` — currently returns `[]` and uses `process.cwd()`; now delegates to `CursorDialect` with worktree + project paths resolved from DB
- **FIX**: `CursorEngine._run()` — slash-command references (e.g. `/gsd-execute-phase`) in `on_enter_prompt` were passed raw to the SDK; now resolved via `CursorDialect.resolvePrompt()` before dispatch
- **FIX**: Skills injection — `.github/skills/` content is now prepended into the system-instructions prefix so agents have AGENTS.md / skill context on every turn
- **FIX**: Cursor native rules — `settingSources: ["project"]` added to SDK local options so `.cursorrules` and `.cursor/rules/*.mdc` are applied by the SDK automatically
- **FIX**: `AgentBusyError` recovery — after a `decision_request` abort, the next turn's `agent.send()` can throw `AgentBusyError` (HTTP 409) due to a fire-and-forget `run.cancel()` race; the worker now retries with `{ local: { force: true } }` per SDK documentation

## Capabilities

### New Capabilities
- `cursor-dialect`: `CursorDialect` implementing `SlashCommandDialect` for the Cursor engine — `.github/prompts/` command discovery, `.github/skills/` skill paths, and slash-command resolution with `$input` substitution

### Modified Capabilities
- `cursor-sdk`: Adds requirements for slash-command resolution via dialect, skills injection, native rules loading via `settingSources`, correct `listCommands` path resolution, and `AgentBusyError` retry behaviour

## Impact

- **Files changed**: `src/bun/engine/dialects/cursor-dialect.ts` (new), `src/bun/engine/cursor/engine.ts`, `src/bun/engine/cursor/worker.mjs`
- **No API or schema changes** — purely engine-internal behaviour
- **No breaking changes** — all changes are additive or fix incorrect silent behaviour
- **Dependencies**: `@cursor/sdk` `AgentBusyError` is already exported from the SDK and importable in `worker.mjs`
