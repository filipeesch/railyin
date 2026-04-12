## 1. read_file Enhancements

- [x] 1.1 Add line number formatting to `read_file` output: `{lineNum padded to 6}→{line}` (1-based)
- [x] 1.2 Add metadata header: `[file: {path}, lines: {totalLines}, showing: {start}-{end}]`
- [x] 1.3 Add mtime tracking: record `mtimeMs` per file path at read time in execution-scoped Map
- [x] 1.4 Add file-unchanged deduplication: return stub message when same file+range re-read with same mtime
- [x] 1.5 Add empty file warning: return `"Warning: the file exists but the contents are empty."` instead of empty string
- [x] 1.6 Add offset-past-EOF warning: return message with actual line count when start_line exceeds file length
- [x] 1.7 Update `read_file` tool description to mention line numbers and metadata header

## 2. edit_file Tool (replaces patch_file)

- [x] 2.1 Add `edit_file` tool definition to `TOOL_DEFINITIONS` with params: `path`, `old_string`, `new_string`, `replace_all?`
- [x] 2.2 Implement `edit_file` executor in `executeTool()`: find old_string, validate uniqueness (or replace_all), apply replacement, return WriteResult with diff
- [x] 2.3 Implement file creation mode: when old_string is empty and file doesn't exist, create file with new_string content
- [x] 2.4 Implement read-before-write enforcement: check execution-scoped mtime map, reject edits to unread files
- [x] 2.5 Adapt `patchDiff()` helper to compute FileDiffPayload from old_string/new_string replacement
- [x] 2.6 Remove `patch_file` from `TOOL_DEFINITIONS`, its `executeTool` case, and from `TOOL_GROUPS["write"]`
- [x] 2.7 Add `edit_file` to `TOOL_GROUPS["write"]`: `["write_file", "edit_file"]`
- [x] 2.8 Update `TOOL_DESCRIPTIONS` map: remove `patch_file`, add `edit_file`

## 3. Remove Redundant Tools

- [x] 3.1 Remove `list_dir` from `TOOL_DEFINITIONS`, `executeTool()`, `TOOL_GROUPS["read"]`, and `TOOL_DESCRIPTIONS`
- [x] 3.2 Remove `delete_file` from `TOOL_DEFINITIONS`, `executeTool()`, `TOOL_GROUPS["write"]`, and `TOOL_DESCRIPTIONS`
- [x] 3.3 Remove `rename_file` from `TOOL_DEFINITIONS`, `executeTool()`, `TOOL_GROUPS["write"]`, and `TOOL_DESCRIPTIONS`
- [x] 3.4 Update `DEFAULT_TOOL_NAMES` to remove `list_dir` (keep `read_file`, `run_command`)

## 4. search_text Rewrite

- [x] 4.1 Add `output_mode` parameter to `search_text` tool definition: enum `["content", "files_with_matches", "count"]`, default `"content"`
- [x] 4.2 Add `limit` (default 250) and `offset` (default 0) parameters to `search_text` tool definition
- [x] 4.3 Implement ripgrep backend: spawn `rg` subprocess with appropriate flags (--hidden, --glob exclusions, --max-columns 500)
- [x] 4.4 Implement `files_with_matches` mode: use `rg -l`, sort by mtime
- [x] 4.5 Implement `count` mode: use `rg -c`, format with total summary
- [x] 4.6 Implement pagination: apply limit/offset to results, show pagination indicator when truncated
- [x] 4.7 Implement ripgrep fallback: detect `rg` absence via `which rg`, fall back to current walker with one-time warning
- [x] 4.8 Increase output cap to 20,000 chars (from 8,000)
- [x] 4.9 Update `search_text` tool description to mention output modes and pagination

## 5. find_files Improvements

- [x] 5.1 Add mtime-based sorting to `find_files`: sort results with most recently modified files first
- [x] 5.2 Add truncation flag: append `"(Results truncated. Consider a more specific pattern.)"` when exceeding 500-file limit

## 6. Sub-agent Cache Prefix Fix

- [x] 6.1 Modify `runSubExecution()` to accept `parentToolDefs` parameter (the parent's full sorted tool definitions)
- [x] 6.2 Pass `parentToolDefs` to the sub-agent's `retryTurn()` call instead of resolving child-specific tool definitions
- [x] 6.3 Implement tool execution whitelist: before executing a tool call, check if the tool name is in the child's `tools` array; return error if not
- [x] 6.4 Pass parent's tool definitions from the engine stream loop through to `runSubExecution()` when handling `spawn_agent` calls

## 7. Sub-agent max_tokens

- [x] 7.1 Change default max_tokens in `runSubExecution()`'s `retryTurn()` call from 8192 to 16384
- [x] 7.2 Update the escalation threshold in `anthropic.ts turn()`: escalate when `initialMaxTokens <= 16384` (instead of `<= 8192`)

## 8. Per-tool Result Size Limits

- [x] 8.1 Add `TOOL_RESULT_LIMITS` map in engine.ts with per-tool maxResultSizeChars values
- [x] 8.2 Update truncation logic in the engine stream loop and `compactMessages()` to use per-tool limits instead of flat `TOOL_RESULT_MAX_CHARS`
- [x] 8.3 Update sub-agent tool result truncation in `runSubExecution()` to use per-tool limits

## 9. Trim Tool Descriptions

- [x] 9.1 Shorten `ask_me` tool description (~408 → ~150 tokens): remove redundant field explanations, keep essential usage info
- [x] 9.2 Shorten `spawn_agent` tool description (~271 → ~150 tokens): remove verbose field explanations
- [x] 9.3 Shorten other tool descriptions where possible (search_internet, fetch_url, task tools)
- [x] 9.4 Update `TOOL_DESCRIPTIONS` map (system prompt descriptions) to match new terse style

## 10. Micro-compact Update

- [x] 10.1 Update `MICRO_COMPACT_CLEARABLE_TOOLS` set: remove `patch_file`, add `edit_file`
- [x] 10.2 Ensure backward compatibility: old `patch_file` results in existing conversations are still cleared (add `patch_file` back to clearable set alongside `edit_file`)

## 11. Config and Workflow Updates

- [x] 11.1 Update `config/workspace.yaml` column tool references: replace `patch_file` → (removed, write group handles it)
- [x] 11.2 Update openspec workflow template tool references if any reference removed tools

## 12. Tests

- [x] 12.1 Test `read_file` line numbers: verify format, partial range, metadata header
- [x] 12.2 Test `read_file` mtime dedup: verify stub on re-read, fresh content after modification
- [x] 12.3 Test `read_file` edge cases: empty file warning, offset-past-EOF warning
- [x] 12.4 Test `edit_file`: single replace, replace_all, not-found error, multiple-match error, file creation
- [x] 12.5 Test `edit_file` read-before-write enforcement: reject unread file, allow after read
- [x] 12.6 Test `search_text` output modes: content, files_with_matches, count
- [x] 12.7 Test `search_text` pagination: limit, offset, truncation indicator
- [x] 12.8 Test sub-agent tool whitelist: allowed tools execute, disallowed tools return error
- [x] 12.9 Test per-tool result limits: verify correct truncation per tool
- [x] 12.10 Test micro-compact clearable tools: edit_file cleared, patch_file backward compat
