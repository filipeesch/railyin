## Why

Analysis of token usage (exec 96: ~$3 for a simple task) and comparison with Free Code's battle-tested tool implementations revealed that Railyin's file tools are significantly less optimized. `read_file` returns raw content without line numbers or metadata, forcing the model to re-read files and guess line positions. `patch_file` uses a 5-mode anchor system that differs from the simpler old_string/new_string pattern that Anthropic models are trained on. `search_text` uses a hand-rolled file walker instead of ripgrep, lacks output modes, and is capped at 8K chars. Three tools (`list_dir`, `delete_file`, `rename_file`) add ~350 tokens of tool definitions but are easily covered by existing tools. Sub-agents also break cache prefixes due to tool set mismatches.

## What Changes

- **`read_file`**: Add line numbers to output, `totalLines`/`showing` metadata header, mtime-based file-unchanged deduplication, empty file and offset-past-EOF warnings
- **`edit_file`** (replaces `patch_file`): **BREAKING** — New tool with `old_string`/`new_string`/`replace_all` model matching Free Code's Edit tool. Enforces read-before-write via mtime tracking. Drops 5-mode position system.
- **`search_text`**: Rewrite with ripgrep backend, add `output_mode` (content/files_with_matches/count), add `offset`/`limit` pagination, increase cap to 20K chars, respect `.gitignore`
- **`find_files`**: Add mtime-based sorting (newest first), truncation flag in output
- **Remove `list_dir`**: Covered by `find_files` with `src/*` or `run_command ls`
- **Remove `delete_file`**: Covered by `run_command rm`
- **Remove `rename_file`**: Covered by `run_command mv`
- **Sub-agent tool mismatch fix**: Sub-agents use parent's full tool definitions for cache prefix sharing, restrict execution via whitelist
- **Sub-agent max_tokens**: Start at 16384 instead of 8192 to avoid retry-escalation spiral
- **Per-tool result size caps**: Replace flat `TOOL_RESULT_MAX_CHARS = 8000` with per-tool limits (search 20K, agent 100K, read_file uses token-based cap)
- **Trim tool descriptions**: Shorten verbose descriptions for `ask_me`, `spawn_agent`, and others (~500 tokens saved)

## Capabilities

### New Capabilities
- `edit-file-tool`: The old_string/new_string file edit tool replacing patch_file, with read-before-write enforcement and replace_all support
- `file-read-enhancements`: Line numbers, totalLines metadata, mtime dedup, empty/offset warnings for read_file
- `per-tool-result-limits`: Configurable per-tool maxResultSizeChars instead of a flat global cap

### Modified Capabilities
- `search-tools`: Add ripgrep backend, output_mode parameter, offset/limit pagination to search_text; add mtime sort and truncation flag to find_files
- `write-tools`: Remove `list_dir`, `delete_file`, `rename_file` from the tool set; replace `patch_file` with `edit_file`
- `patch-file`: **BREAKING** — Replaced entirely by `edit-file-tool`. Old 5-mode position system removed.
- `micro-compact`: Update clearable tools set — remove `patch_file`, add `edit_file`
- `spawn-agent`: Sub-agents use parent's full tool definitions for API calls (cache prefix sharing), restrict tool execution via whitelist; default max_tokens raised to 16384
- `column-tool-config`: Update default tool set to reference `edit_file` instead of `patch_file`; remove `list_dir` from defaults

## Impact

- `src/bun/workflow/tools.ts` — Major rewrite: new tool definitions, new executeTool cases, removed tools, ripgrep integration
- `src/bun/workflow/engine.ts` — Sub-agent tool passing, per-tool result caps, max_tokens default
- `src/bun/ai/anthropic.ts` — No changes needed (tool definitions are passed through)
- `config/workspace.yaml` — Update column tool references
- `openspec/specs/` — Multiple spec files updated
- **Breaking**: Existing workflow configs referencing `patch_file`, `list_dir`, `delete_file`, or `rename_file` will need updating
