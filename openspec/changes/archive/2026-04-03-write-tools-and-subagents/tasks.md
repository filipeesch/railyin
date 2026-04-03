## 1. Tool Definitions — write group

- [x] 1.1 Add `write_file` to `TOOL_DEFINITIONS` in `tools.ts` (path, content params)
- [x] 1.2 Add `replace_in_file` to `TOOL_DEFINITIONS` (path, old_string, new_string params)
- [x] 1.3 Add `delete_file` to `TOOL_DEFINITIONS` (path param)
- [x] 1.4 Add `rename_file` to `TOOL_DEFINITIONS` (from_path, to_path params)

## 2. Tool Definitions — search group

- [x] 2.1 Add `search_text` to `TOOL_DEFINITIONS` (pattern, glob? params)
- [x] 2.2 Add `find_files` to `TOOL_DEFINITIONS` (glob param)

## 3. Tool Executor — write group

- [x] 3.1 Implement `write_file` case in `executeTool` (safePath check, mkdirSync for parent dirs, writeFileSync)
- [x] 3.2 Implement `replace_in_file` case (read file, count occurrences of old_string, reject if ≠ 1, write replacement)
- [x] 3.3 Implement `delete_file` case (safePath check, existsSync guard, unlinkSync)
- [x] 3.4 Implement `rename_file` case (safePath for both paths, renameSync)

## 4. Tool Executor — search group

- [x] 4.1 Implement `search_text` case (spawnSync grep -rn with optional --include glob, truncate output)
- [x] 4.2 Implement `find_files` case (glob expansion via readdirSync recursion or spawnSync find, return relative paths)

## 5. Tool Groups + resolveToolsForColumn

- [x] 5.1 Define `TOOL_GROUPS: Map<string, string[]>` in `tools.ts` with groups: `read`, `write`, `search`, `shell`, `interactions`, `agents`
- [x] 5.2 Update `resolveToolsForColumn` to expand group names via `TOOL_GROUPS` before looking up individual tool names; deduplicate final list

## 6. Extend run_command block-list

- [x] 6.1 Add shell write redirection operators (`>`, `>>`) and `tee` to the `BLOCKED_COMMANDS` regex in `tools.ts`

## 7. spawn_agent — tool definition

- [x] 7.1 Add `spawn_agent` to `TOOL_DEFINITIONS` (children: array of `{ instructions: string, tools: string[], scope?: string }`)

## 8. spawn_agent — engine interception

- [x] 8.1 Add `runSubExecution` helper in `engine.ts`: accepts `{ worktreePath, instructions, tools }`, runs tool-call loop independently, returns string summary
- [x] 8.2 In `runExecution` tool-call loop, detect `spawn_agent` calls before the `executeTool` catch-all
- [x] 8.3 Parse children array from `spawn_agent` args, resolve each child's tools via `resolveToolsForColumn`
- [x] 8.4 Run all children concurrently with `Promise.all`; catch per-child errors and convert to error strings
- [x] 8.5 Inject results as a `tool_result` message and continue the loop (no execution suspension)

## 9. Workflow YAML update

- [x] 9.1 Update `config/workflows/delivery.yaml` — replace individual tool names with group names where applicable; add `write`, `search`, `agents` to `in_progress` column

## 10. Context message update

- [x] 10.1 Update the worktree context system message in `assembleMessages` to document the new write, search, and spawn_agent tools

## 11. Tests

- [x] 11.1 Add unit tests for `write_file` executor (create, overwrite, path traversal rejection)
- [x] 11.2 Add unit tests for `replace_in_file` (success, ambiguous match, no match)
- [x] 11.3 Add unit tests for `delete_file` and `rename_file`
- [x] 11.4 Add unit tests for `search_text` and `find_files`
- [x] 11.5 Add unit tests for `resolveToolsForColumn` group expansion and deduplication
- [x] 11.6 Add unit tests for `run_command` block-list (redirection operators rejected)
- [x] 11.7 Add integration test for `spawn_agent`: fake AI queues a spawn_agent call, verify child runs execute and results are returned to parent
