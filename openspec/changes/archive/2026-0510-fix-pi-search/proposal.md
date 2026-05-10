## Why

The search tools never return any result in Pi engine, regardless what is passed. This is because our custom `search_text` tool depends on ripgrep (`rg`) which is not installed as a project dependency. When `rg` is not found, `spawnSync` returns `status === null` which is not handled as an error — it falls through to the "no matches" path, indistinguishable from actual zero results.

The search is critical for all Pi engine workflow columns that reference the `search` tool group. Without working search, the LLM cannot discover code, verify patterns, or navigate the codebase effectively.

## What Changes

- **Remove** `src/bun/engine/pi/tools/search.ts` — completely broken tool with no working path, zero callers of `invalidateSearchByPath`
- **Remove** `search` tool group from `src/bun/engine/pi/tools/index.ts` — dead code (`PICOMATCH` import only used here)
- **Remove** `search` from `DEFAULT_PI_TOOL_GROUPS` — no harness search implementation
- **Update** `src/bun/engine/pi/engine.ts` — enable Pi SDK's `grep`/`find`/`ls` tools via `tools: ["grep", "find", "ls"]`
- **Remove** `- search` from `config/workflows/delivery.yaml` `plan` and `in_progress` columns — no longer needed
- **Extract** `buildSessionOptions()` helper from `getOrCreateSession()` — enables clean DI template for `createAgentSession` params

## Capabilities

### Modified Capabilities
- `engine-tools`: Pi engine tool registry now provides search via SDK built-in tools (`grep`, `find`, `ls`) instead of broken custom harness. Column-gating for search is removed since SDK tools are always available.

### New Capabilities
<none>

## Impact

- **Files changed**: `src/bun/engine/pi/engine.ts`, `src/bun/engine/pi/tools/index.ts`, `config/workflows/delivery.yaml`
- **File deleted**: `src/bun/engine/pi/tools/search.ts` (~174 lines removed)
- **Dependencies removed**: `picomatch` (only used in search.ts)
- **Dependencies**: No new dependencies. Pi SDK's `grep` auto-downloads `rg` if missing via `ensureTool("rg", true)`.
- **Breaking**: Workflow YAML files referencing `- search` in tool groups will silently ignore it (no-op). Cleaned up in this change.
- **Search behavior**: SDK `grep` has different schema than old `search_text` (e.g., `pattern`, `glob`, `context`, `ignoreCase`, `literal`, `limit` vs custom `output_mode` and `offset` pagination). LLM system prompts may need updating.
