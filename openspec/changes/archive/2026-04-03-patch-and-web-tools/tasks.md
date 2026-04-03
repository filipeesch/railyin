## 1. Config — Add search block to WorkspaceYaml

- [x] 1.1 Add `search?: { engine: string; api_key: string }` field to `WorkspaceYaml` interface in `src/bun/config/index.ts`
- [x] 1.2 Add commented-out `search` block to `DEFAULT_WORKSPACE_YAML` template in `src/bun/config/index.ts`
- [x] 1.3 Add `search` block (commented out) to `config/workspace.yaml`

## 2. Rename ask_user → ask_me

- [x] 2.1 Rename `ask_user` tool definition name and description in `TOOL_DEFINITIONS` in `src/bun/workflow/tools.ts`
- [x] 2.2 Rename `ask_user` → `ask_me` in `TOOL_GROUPS` `interactions` entry in `src/bun/workflow/tools.ts`
- [x] 2.3 Rename `ask_user` interception check in `runExecution` in `src/bun/workflow/engine.ts`
- [x] 2.4 Update worktree context system message in `engine.ts` to reference `ask_me`
- [x] 2.5 Update `delivery.yaml` if `ask_user` appears explicitly (it should only be in the `interactions` group — verify)
- [x] 2.6 Update `ask_user` → `ask_me` in all tests in `src/bun/test/engine.test.ts` and `src/bun/test/tools.test.ts`

## 3. Remove replace_in_file

- [x] 3.1 Remove `replace_in_file` tool definition from `TOOL_DEFINITIONS` in `tools.ts`
- [x] 3.2 Remove `replace_in_file` from `TOOL_GROUPS` `write` entry in `tools.ts`
- [x] 3.3 Remove `replace_in_file` case from `executeTool` switch in `tools.ts`
- [x] 3.4 Remove or replace all `replace_in_file` test cases in `tools.test.ts` (they'll become `patch_file` tests)

## 4. Add patch_file tool

- [x] 4.1 Add `patch_file` tool definition to `TOOL_DEFINITIONS` (params: `path`, `content`, `position`, `anchor?`) in `tools.ts`
- [x] 4.2 Add `patch_file` to `TOOL_GROUPS` `write` entry in `tools.ts`
- [x] 4.3 Implement `patch_file` case in `executeTool`:
  - Validate path with `safePath`
  - Handle `position: "start"` — prepend content
  - Handle `position: "end"` — append content
  - Handle `position: "before"` — require anchor, unique check, insert before
  - Handle `position: "after"` — require anchor, unique check, insert after
  - Handle `position: "replace"` — require anchor, unique check, replace anchor with content
- [x] 4.4 Write tests for all five `patch_file` positions in `tools.test.ts`
- [x] 4.5 Write test for anchor ambiguity rejection in `tools.test.ts`
- [x] 4.6 Write test for missing anchor rejection in `tools.test.ts`
- [x] 4.7 Write test for path traversal rejection in `tools.test.ts`

## 5. Enhance read_file with partial reads

- [x] 5.1 Add `start_line` and `end_line` optional params to `read_file` tool definition schema in `tools.ts`
- [x] 5.2 Implement line range slicing in `read_file` case: split content on `\n`, slice `[start_line-1 .. end_line]`, rejoin
- [x] 5.3 Handle edge cases: `start_line` only (read to EOF), `end_line` beyond file length (read to EOF)
- [x] 5.4 Write tests for partial read with both params, start only, and full read omitted in `tools.test.ts`

## 6. Enhance search_text with context_lines

- [x] 6.1 Add `context_lines` optional param to `search_text` tool definition schema in `tools.ts`
- [x] 6.2 Include `-C ${context_lines}` in grep args when `context_lines` is provided and > 0 in `executeTool`
- [x] 6.3 Write tests for `context_lines` present vs. omitted in `tools.test.ts`

## 7. Add fetch_url tool

- [x] 7.1 Add `fetch_url` tool definition to `TOOL_DEFINITIONS` (param: `url`) in `tools.ts`
- [x] 7.2 Add `fetch_url` to a new `TOOL_GROUPS` `web` entry in `tools.ts`
- [x] 7.3 Implement SSRF hostname resolution check (use `dns.lookup` via Bun/Node, reject private IPs)
- [x] 7.4 Implement fetch using Bun built-in `fetch`, read response body up to 100KB
- [x] 7.5 Strip `<script>...</script>` and `<style>...</style>` blocks from HTML
- [x] 7.6 Strip remaining HTML tags (regex `<[^>]+>`) and normalize whitespace
- [x] 7.7 Write test for successful fetch (mock or use a local server) in `tools.test.ts`
- [x] 7.8 Write test for SSRF private IP rejection in `tools.test.ts`
- [x] 7.9 Write test for 100KB truncation in `tools.test.ts`

## 8. Add search_internet tool

- [x] 8.1 Add `search_internet` tool definition to `TOOL_DEFINITIONS` (param: `query`) in `tools.ts`
- [x] 8.2 Add `search_internet` to `TOOL_GROUPS` `web` entry alongside `fetch_url` in `tools.ts`
- [x] 8.3 Pass `ToolContext` the loaded config (or extend context to carry `search` config) — update `ToolContext` interface if needed
- [x] 8.4 Implement `search_internet` case: check `ctx.searchConfig` for engine + api_key, return config error if missing
- [x] 8.5 Implement Tavily API call: `POST https://api.tavily.com/search` with `{ query, max_results: 5 }`
- [x] 8.6 Format response as `title | url\nsnippet\n` per result
- [x] 8.7 Write test for unconfigured search returning config error in `tools.test.ts`
- [x] 8.8 Write test for Tavily API error path in `tools.test.ts`

## 9. Update delivery.yaml and system message

- [x] 9.1 Add `web` to `in_progress` tools array in `config/workflows/delivery.yaml`
- [x] 9.2 Update worktree context system message in `engine.ts` to list `web` group and its tools (`fetch_url`, `search_internet`)
- [x] 9.3 Update system message in `engine.ts` to reflect `patch_file` replacing `replace_in_file`
- [x] 9.4 Update system message in `engine.ts` to document `read_file` partial-read params and `search_text` `context_lines`

## 10. Run tests and verify

- [x] 10.1 Run `bun test` and confirm all tests pass (expect 70+ tests)
- [x] 10.2 Verify `resolveToolsForColumn` with `web` group returns `[fetch_url, search_internet]`
