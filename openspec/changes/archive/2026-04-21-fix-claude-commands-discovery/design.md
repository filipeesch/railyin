## Context

`ClaudeEngine.listCommands(taskId)` currently resolves the `worktree_path` from `task_git_context` and passes it as `cwd` to the Claude SDK's `query.supportedCommands()`. Git worktrees are isolated branch checkouts — the project-level `.claude/commands/` directory lives in the **project root** (`projectPath`), not in the worktree. As a result, the slash-command picker is always empty for Claude engine tasks.

A secondary issue: the `engine.listCommands` RPC is called on every `/` keystroke in `ChatEditor.vue` with no caching. The SDK spins up a child process per call (~2–5 s), making autocomplete feel broken.

The Copilot engine already solves the equivalent problem by scanning both `worktreePath` and `projectPath` using `collectCopilotCommands`. The Claude engine needs the same awareness, leveraging the SDK instead of filesystem scanning.

## Goals / Non-Goals

**Goals:**
- `ClaudeEngine.listCommands` passes `projectPath` as `cwd` to the SDK so project-level `.claude/commands/` is discovered correctly.
- A `useCommandsCache` composable provides stale-while-revalidate caching in the UI: return cached data immediately, refresh in background, update UI only if the list changed.
- Background refresh is throttled to at most once per 30 minutes.

**Non-Goals:**
- Caching on the backend (orchestrator or DB) — frontend cache is sufficient and simpler.
- Merging worktree-local and project-root commands — `projectPath` via SDK covers user expectations; worktree-specific commands are a future concern.
- Changing Copilot engine command discovery — it works correctly today.
- Explicit external cache invalidation API — the background refresh loop handles freshness.

## Decisions

### Decision: Pass `projectPath` to the SDK, not `worktreePath`

**Choice:** In `ClaudeEngine.listCommands`, look up `projectPath` from the project store (same source used by `_resolveWorkingDirectory` fallback) and use it as `cwd` for `sdkAdapter.listCommands`.

**Why over `worktreePath`:** The Claude SDK scans the `cwd` for `.claude/commands/`. Project commands live in the project root. Worktrees only contain checked-out source — they do not carry the `.claude/` config unless it is committed to the branch (uncommon).

**Why over `collectClaudeCommands` filesystem scan:** The SDK approach inherits user-level (`~/.claude/commands/`) and SDK-internal command discovery for free, without duplicating logic. It also stays consistent with how the engine already works for execution (`cwd: workingDirectory` where `workingDirectory` comes from `projectPath` when no worktree is ready).

**Fallback:** If `projectPath` is unavailable, fall back to `worktreePath`, then `process.cwd()` — matching existing `listModels` behavior.

### Decision: SWR cache in a module-level composable (`useCommandsCache`)

**Choice:** A new `src/mainview/composables/useCommandsCache.ts` exports a `getCommands(taskId)` async function backed by a module-level `Map<number, CacheEntry>`.

**Why module-level over Pinia:** Commands are transient UI state tied to the autocomplete trigger path, not shared domain state. Module scope is simpler, persists across component remounts (task switching), and is GC'd naturally on app close.

**Why UI layer over backend cache:** The backend call is the slow path (SDK process). Caching at the call site avoids any overhead and is fully self-contained. Backend complexity is unwarranted for a list of filenames.

**SWR behavior:**
1. If cache is empty → `await` fetch, store, return. (First call is always fresh.)
2. If cache is populated → return immediately, then fire background refresh (non-blocking).
3. Background refresh compares result to cache using sorted JSON equality. If equal, only `fetchedAt` is updated (no reactive update, no re-render). If different, cache and reactive ref are updated — next `/` open shows new list.
4. Refresh is skipped if `revalidating: true` (prevents parallel calls) or if last fetch was within 30 minutes.

```
cache entry shape:
{
  commands: CommandInfo[],   // current list
  fetchedAt: number,         // Date.now() of last successful fetch
  revalidating: boolean      // guard against parallel refreshes
}
```

**Equality check:** Sort by `name`, compare `JSON.stringify`. Stable, cheap for typical command list sizes (<100 items).

## Risks / Trade-offs

- **Stale for up to 30 min after adding a command**: User adds `.claude/commands/foo.md`, opens the picker within the same session — they see the old list until the 30-min TTL triggers a background refresh. Acceptable given commands rarely change mid-session; refreshed list appears silently on the next open after the refresh completes.
- **SDK process cost on first open per task**: The very first `/` per task still blocks on the SDK call. This is unavoidable without eager pre-fetching. Could be addressed in a follow-up by pre-fetching when a task becomes active.
- **Module-level map leaks if tasks are deleted**: Entries for deleted tasks remain in the Map until app restart. Given typical task counts this is negligible; can be addressed with an explicit `clearCommandsCache(taskId)` call from the task cleanup path if needed.
