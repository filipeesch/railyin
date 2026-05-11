## Context

### Current State
Pi engine uses custom harness tools registered via `noTools: "builtin"` which disables all Pi SDK built-in tools. The custom `search_text` tool in `src/bun/engine/pi/tools/search.ts` calls `spawnSync("rg", ...)` to run ripgrep, but `rg` is not a project dependency and not installed system-wide in most environments.

When `rg` is not found:
- `spawnSync` returns `status === null` with `result.error` set
- Code only handles `status === 2` as an error
- Falls into the "no matches" path → returns `"[No matches for pattern: ...]"` — indistinguishable from actual zero results

### Pi SDK Capability
Pi SDK (`@earendil-works/pi-coding-agent`) ships `tools?: string[]` option that **selectively enables** built-in tools alongside `customTools`. When provided:
- SDK's `grep` — pure-JS regex search with `.gitignore` awareness, auto-downloads `rg` via `ensureTool("rg", true)` if missing
- SDK's `find` — file discovery via `fd`
- SDK's `ls` — directory listing

These are completely self-sufficient — no project-level dependencies needed.

## Goals / Non-Goals

**Goals:**
- Working search in Pi engine for all workflow columns
- Zero new project dependencies
- Clean removal of dead `search_text` code
- Backward-compatible workflow YAML handling

**Non-Goals:**
- Testing the fix (defers to task #403 test plan)
- LLM system prompt updates (tool schemas differ, but prompt changes are out of scope for this fix)
- Performance benchmarking of SDK vs custom search

## Decisions

### Decision 1: Remove `search_text` entirely instead of fixing with @vscode/ripgrep

**Rationale:** Pi SDK provides a fully-working `grep` via `ensureTool("rg", true)` which auto-downloads when needed. Our custom `search_text` has:
- No error path for missing `rg` (status `null`)
- `invalidateSearchByPath` — zero callers (dead code)
- Custom `output_mode` and pagination that SDK doesn't need

**Alternative considered:** Bundle `@vscode/ripgrep` as npm dependency. Rejected because:
- Adds platform-specific binary dependencies (~7MB each)
- No value-add over SDK's working solution
- Introduces maintenance burden for dependency updates

### Decision 2: Enable SDK `grep`/`find`/`ls` + keep custom harness tools

**Rationale:** `noTools: "builtin"` only disables default editor tools (`read`, `bash`, `edit`, `write`). Adding `tools: ["grep", "find", "ls"]` enables search tools **alongside** our custom tools. No name collision — SDK tools are `grep`/`find`/`ls`, our tools are `read_file`/`glob`/etc.

**Impact on column-gating:** The `search` tool group in workflow YAML becomes redundant since SDK tools are always available. Removed from YAML config.

### Decision 3: Search no longer column-gated via YAML

**Rationale:** SDK search tools (`grep`/`find`) are always available regardless of column config. This is acceptable because:
- Search is read-only — no security implications
- SDK `grep` respects `.gitignore` and is sandbox-aware
- Having different search per column was never enforced anyway (broken tool)

**Before:** `in_progress` column had `["read", "write", "search", "web", "shell", "interactions", "agents"]`
**After:** `in_progress` column has `["read", "write", "web", "shell", "interactions", "agents"]` — search is always available via SDK

## Risks / Trade-offs

| Risk | Mitigation |
|------|-----------|
| SDK `ensureTool("rg", true)` downloads fail in sandboxed/environments without network access | The SDK tool will gracefully fail with a clear error message — better than our silent "no matches" |
| SDK `grep` schema differs from old `search_text` — LLM needs to learn new tool names | System prompts should reference `grep`/`find`/`ls` for Pi engine — part of prompt maintenance, not this change |
| Workflow YAML files reference `- search` and silently become no-op if this change is rolled back | We're cleaning up the YAML, so `- search` is removed. If rolled back, the `- search` lines need restoring |
| SDK tools bypass our harness caching (`ContentHashCache`) | SDK `grep` has its own internal caching. Our `glob` tool still uses harness cache for read_file operations |

## Migration Plan

### Deployment Steps
1. Remove `src/bun/engine/pi/tools/search.ts`
2. Update `src/bun/engine/pi/tools/index.ts` — remove `search` group
3. Update `src/bun/engine/pi/engine.ts` — add `tools: ["grep", "find", "ls"]` to `createAgentSession`
4. Update `config/workflows/delivery.yaml` — remove `- search` from `plan` and `in_progress` columns

### Rollback
If needed, restore `search.ts`, restore `tools/index.ts`, revert `engine.ts`. YAML changes are additive (if `- search` is missing, tool is ignored by `buildAllTools` filter).
