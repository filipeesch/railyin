## Why

`ClaudeEngine.listCommands` passes the git worktree path as the Claude SDK's `cwd`, but user-defined slash commands live in the **project root** (e.g. `.claude/commands/*.md`). Worktrees are checked-out branches — they do not contain the project-root command files — so the command picker shows an empty list for Claude engine tasks. Additionally, every `/` keystroke triggers a fresh, slow SDK process (~2–5 s) with no caching, making autocomplete feel unresponsive.

## What Changes

- **Fix working directory**: `ClaudeEngine.listCommands` SHALL pass `projectPath` (the configured project root) as the `cwd` to the Claude SDK instead of `worktreePath`, so the SDK discovers commands from the correct directory.
- **Add SWR cache in UI**: A new `useCommandsCache` composable SHALL cache the command list per task in a module-level Map. On every `/` trigger it returns cached data immediately (zero wait), then fires a background refresh. The UI is updated only if the refreshed list differs from the cached one — preventing unnecessary re-renders when nothing changed. The background refresh is throttled to at most once every 30 minutes.

## Capabilities

### New Capabilities
- `slash-command-swr-cache`: Client-side stale-while-revalidate cache for slash command discovery, scoped per task, stored in a module-level composable.

### Modified Capabilities
- `claude-engine`: The `listCommands` working directory resolution must use `projectPath` instead of `worktreePath`.
- `slash-command-autocomplete`: Claude engine command discovery now uses `projectPath` as `cwd`; UI layer gains a SWR cache so the picker responds instantly.

## Impact

- `src/bun/engine/claude/engine.ts` — `listCommands` path resolution logic
- `src/mainview/composables/useCommandsCache.ts` — new composable
- `src/mainview/components/ChatEditor.vue` — use composable instead of direct `api()` call
