## 1. Backend — Fix `ClaudeEngine.listCommands` path

- [x] 1.1 In `ClaudeEngine.listCommands`, resolve `projectPath` from the project store (using `board_id` + `project_key` from the task) and pass it as `cwd` to `sdkAdapter.listCommands`
- [x] 1.2 Add fallback chain: `projectPath` → `worktree_path` → `process.cwd()` when project path cannot be resolved

## 2. Frontend — `useCommandsCache` composable

- [x] 2.1 Create `src/mainview/composables/useCommandsCache.ts` with a module-level `Map<number, CacheEntry>` (fields: `commands`, `fetchedAt`, `revalidating`)
- [x] 2.2 Implement `getCommands(taskId)`: if cache miss → await fetch and store; if cache hit → return immediately and trigger background refresh
- [x] 2.3 Implement background refresh: skip if `revalidating` or last fetch < 30 min ago; compare result using sorted JSON equality; update cache + reactive ref only if list changed
- [x] 2.4 Export a helper `clearCommandsCache(taskId)` for future cleanup call sites

## 3. Frontend — Wire `ChatEditor.vue`

- [x] 3.1 Replace the direct `api("engine.listCommands", { taskId })` call in `slashCompletions` with `getCommands(taskId)` from the new composable

## 4. Tests

- [x] 4.1 Add unit tests for `ClaudeEngine.listCommands` verifying `projectPath` is used as `cwd`, with fallback to `worktreePath`
- [x] 4.2 Add unit tests for `useCommandsCache`: cache miss blocks, cache hit returns immediately, background refresh deduplication, equality check prevents unnecessary update
- [x] 4.3 Write and run e2e tests for slash command discovery
