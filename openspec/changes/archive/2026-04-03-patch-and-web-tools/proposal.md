## Why

The current tool suite has redundancy (`replace_in_file` covers only one of several in-place edit patterns) and gaps (no web access, no partial file reads, no context lines in search). Agents spend extra tool calls reading full large files and re-reading search results. The naming `ask_user` is also inconsistent with the first-person product voice.

## What Changes

- **BREAKING** Rename `ask_user` → `ask_me` in tool definitions, engine interception, TOOL_GROUPS, system message, delivery.yaml, and all tests
- **BREAKING** Remove `replace_in_file` — superseded by `patch_file`
- Add `patch_file` tool: unified in-place edit with `position: "start" | "end" | "before" | "after" | "replace"` and optional `anchor`
- Add `start_line` / `end_line` optional params to `read_file` for partial reads
- Add `context_lines` optional param to `search_text` (maps to `grep -C N`)
- Add `fetch_url` tool: downloads a URL and returns clean text (always available, SSRF-guarded)
- Add `search_internet` tool: queries a web search API; disabled gracefully if not configured
- Add `web` tool group: `[fetch_url, search_internet]`
- Add `search` config block to `WorkspaceYaml` type and `workspace.yaml` default template
- Update `interactions` group to use `ask_me`
- Update `delivery.yaml` to add `web` group to `in_progress`

## Capabilities

### New Capabilities

- `patch-file`: Unified file patching tool replacing `replace_in_file` with four position modes
- `fetch-url`: Fetches a URL and returns readable plain text with SSRF protection
- `search-internet`: Queries a search engine API (Tavily or Brave) configured in workspace.yaml

### Modified Capabilities

- `write-tools`: `replace_in_file` removed; `patch_file` added; `read_file` gains partial-read params
- `search-tools`: `search_text` gains `context_lines` param; new `web` group added
- `workflow-engine`: `ask_user` interception renamed to `ask_me`; system message updated with new groups

## Impact

- `src/bun/workflow/tools.ts`: primary changes — new tool definitions, updated TOOL_GROUPS, updated executeTool switch
- `src/bun/config/index.ts`: `WorkspaceYaml` gets `search?` field; default template updated
- `src/bun/workflow/engine.ts`: `ask_user` interception renamed to `ask_me`; system message updated
- `config/workspace.yaml`: add `search` block (commented out by default)
- `config/workflows/delivery.yaml`: add `web` to `in_progress` tools
- `src/bun/test/tools.test.ts`: update all `replace_in_file` tests → `patch_file`; add new tool tests
- `src/bun/test/engine.test.ts`: rename `ask_user` → `ask_me` in interception test
- New runtime dependency: `node-fetch` or native `fetch` (Bun has built-in fetch — no new dep needed)
- External runtime dependency for `search_internet`: Tavily or Brave API key in workspace.yaml
