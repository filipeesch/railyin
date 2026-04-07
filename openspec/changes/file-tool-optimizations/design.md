## Context

Token usage analysis of exec 96 (~$3 for a simple task) revealed several inefficiencies in tool design. Comparison with Free Code (Claude Code's open-source fork) — which has been battle-tested against Anthropic models — showed our file tools diverge from proven patterns in ways that cost tokens and reduce accuracy. This change aligns Railyin's file tools with Free Code's approach while also fixing sub-agent cache prefix mismatches and introducing per-tool result size limits.

Current state:
- `read_file` returns raw content without line numbers — model can't reference positions without counting
- `patch_file` uses a 5-mode position system unique to Railyin — models make more mistakes with it than with simple old_string/new_string
- `search_text` is a hand-rolled recursive walker, ~100x slower than ripgrep, doesn't respect .gitignore, capped at 8K chars
- 3 tools (`list_dir`, `delete_file`, `rename_file`) add ~350 tokens to every API call but are trivially replaced by `run_command` or `find_files`
- Sub-agents resolve their own (smaller) tool set, breaking the cache prefix → cold writes at ~$0.37 each
- Flat `TOOL_RESULT_MAX_CHARS = 8000` over-truncates search results and under-truncates agent output

## Goals / Non-Goals

**Goals:**
- Match Free Code's proven tool patterns for file read, edit, and search
- Reduce tool definition token overhead by removing redundant tools and trimming descriptions
- Fix sub-agent cache prefix mismatch (biggest single cost saving)
- Introduce per-tool result size limits for better output fidelity
- Add file-unchanged deduplication to avoid wasting tokens on re-reads

**Non-Goals:**
- Not changing `run_command`, `ask_me`, `spawn_agent`, `fetch_url`, `search_internet`, or task/todo tools (beyond description trimming)
- Not implementing Anthropic's `cache_edits` or `context_management.edits` APIs
- Not adding secondary model summarization for web fetch results
- Not changing the conversation compaction or micro-compact algorithms (only updating the clearable tool list)

## Decisions

### 1. Replace `patch_file` with `edit_file` (old_string/new_string model)

The new `edit_file` tool takes `path`, `old_string`, `new_string`, and optional `replace_all`. When `old_string` is empty and the file doesn't exist, it creates the file. When `old_string` matches exactly once, it replaces it. When `replace_all` is true, replaces all occurrences.

**Rationale**: Free Code's `Edit` tool uses this exact model and it's the most reliable pattern with Anthropic models. The model copies text directly from `read_file` output (which now has line numbers) into `old_string`. The 5-mode position system (`start`/`end`/`before`/`after`/`replace`) was Railyin-specific and caused more anchor-miss errors.

**Alternative considered**: Keep `patch_file` alongside `edit_file` — rejected because two edit tools would confuse the model and waste tool definition tokens.

**Migration**: The existing `patchDiff()` function for computing UI diffs will be adapted to work with old_string/new_string operations. The `WriteResult` type stays unchanged.

### 2. Add line numbers and metadata header to `read_file`

Output format changes from raw content to:
```
[file: src/foo.ts, lines: 342, showing: 1-50]
     1→import React from 'react'
     2→
     3→function App() {
```

Line numbers are padded to 6 characters with an arrow separator (`→`), matching Free Code's format.

**Rationale**: Line numbers let the model reference exact positions. The metadata header tells the model total file size and the range shown, preventing unnecessary full re-reads. Free Code uses the same format and reports ~18% fewer re-reads due to deduplication.

### 3. Mtime-based file-unchanged deduplication

Track `mtimeMs` for each file path read during an execution. When the same file+range is re-read with identical mtime, return: `"File unchanged since last read — refer to the earlier tool result."` (~15 tokens instead of ~2000).

**Rationale**: Free Code reports ~18% of Read calls are same-file re-reads with unchanged content. Each duplicate wastes tokens in both the tool result and the cache write.

**Scope**: Tracked per-execution (cleared when execution ends). Sub-agents don't share the parent's mtime cache.

### 4. Rewrite `search_text` with ripgrep backend

Replace the hand-rolled `readdirSync` + `RegExp.test()` walker with a `ripgrep` subprocess call. Add parameters:
- `output_mode`: `"content"` (default), `"files_with_matches"`, `"count"`
- `limit`: max results to return (default 250)
- `offset`: skip first N results (for pagination)

Cap output at 20,000 chars (up from 8,000).

**Rationale**: ripgrep is ~100x faster, respects `.gitignore`, has `--max-columns` to skip minified files, and supports all three output modes natively. The pagination model (limit+offset) matches Free Code's and lets the model do exploratory searches cheaply.

**Dependency**: `ripgrep` (`rg`) must be installed on the host. It's available via Homebrew, apt, and most package managers. We'll detect its absence and fall back to the current implementation with a warning.

### 5. Remove `list_dir`, `delete_file`, `rename_file`

These three tools add ~350 tokens to every API call. Each is trivially handled by existing tools:
- `list_dir` → `find_files` with `src/*` or `run_command ls`
- `delete_file` → `run_command rm path`
- `rename_file` → `run_command mv from to`

**Rationale**: Free Code doesn't have dedicated list/delete/rename tools — they're all handled via Bash. Removing them saves ~350 tokens per API call across every round of every execution.

**Breaking change**: Workflow configs referencing these tools will need updating. The system will log warnings for unknown tool names (existing behavior) so nothing breaks silently.

### 6. Sub-agents use parent's full tool definitions

When `runSubExecution` creates a sub-agent, it passes the **parent's full tool definitions** to the API call (so the `[system, tools]` cache prefix matches the parent's). The child's `tools` array from `spawn_agent` is used only as an execution whitelist — if the model calls a tool not in the whitelist, the executor returns an error.

**Rationale**: This is the biggest single cost saving. Currently each sub-agent's different tool set causes a full cache miss (~$0.37 cold write on 60K tokens). With shared tool definitions, the first sub-agent call gets a cache hit (~$0.02).

### 7. Sub-agent default max_tokens raised to 16384

Sub-agents currently start at 8192 max_tokens. The `turn()` method retries at 64000 when truncated, causing a full duplicate API call. Starting at 16384 eliminates most retry-escalation rounds.

**Rationale**: Sub-agents frequently produce long output (full file reads, search results). The retry at 64000 doubles the cost of those rounds. 16384 covers 95%+ of sub-agent responses.

### 8. Per-tool result size limits

Replace the flat `TOOL_RESULT_MAX_CHARS = 8000` with per-tool limits:

| Tool | Limit |
|------|-------|
| `read_file` | 25,000 tokens (checked post-read, not chars) |
| `search_text` | 20,000 chars |
| `edit_file` | 2,000 chars (just the confirmation) |
| `write_file` | 2,000 chars |
| `find_files` | 10,000 chars |
| `run_command` | 30,000 chars |
| `spawn_agent` | 100,000 chars |
| `lsp` | 100,000 chars |
| All others | 8,000 chars (current default) |

**Rationale**: The current 8K flat cap over-truncates search and command output while being unnecessarily generous for write confirmations. Free Code uses per-tool limits ranging from 20K to 100K.

### 9. Trim tool descriptions

Shorten verbose descriptions for `ask_me` (~408 tokens → ~150 tokens), `spawn_agent` (~271 tokens → ~150 tokens), and other tools. Focus on essential usage instructions, remove redundant explanations.

**Rationale**: ~500 tokens saved per API call. Adds up across all rounds.

## Risks / Trade-offs

- **[`patch_file` removal is breaking]** → Mitigation: existing workflow YAML files referencing `patch_file` will get a warning. The new `edit_file` covers all use cases. Old executions in conversation history with `patch_file` calls will still work through compactMessages (tool name in stored messages doesn't affect future calls).
- **[ripgrep must be installed]** → Mitigation: fall back to current implementation if `rg` is not found, with a one-time warning. Bun can detect with `which rg`.
- **[Removing list_dir/delete_file/rename_file]** → Mitigation: these are covered by `run_command` and `find_files`. The model naturally uses shell commands when dedicated tools aren't available.
- **[Sub-agent tool whitelist false positives]** → Mitigation: the error message clearly states "tool X not available to this sub-agent" so the model understands and adjusts. The model rarely calls tools outside its instructions anyway.
- **[Mtime dedup may miss file changes from outside]** → Mitigation: only dedup within a single execution. External changes during an execution are rare and the model can always request a forced re-read by using start_line/end_line (range reads bypass dedup).
