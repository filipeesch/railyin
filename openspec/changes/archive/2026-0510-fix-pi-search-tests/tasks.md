# Implementation Tasks

## 1. Create unit tests for PI_TOOL_GROUPS and buildAllTools

- [x] 1.1 Create `src/bun/test/tool-registry.test.ts` — test file
- [x] 1.2 Validate `PI_TOOL_GROUPS` has exactly 4 entries (read, write, shell, web)
- [x] 1.3 Validate `DEFAULT_PI_TOOL_GROUPS` has exactly 3 entries (read, write, shell)
- [x] 1.4 Validate `buildAllTools()` returns tools matching the 4 named groups
- [x] 1.5 Validate `buildAllTools()` returns no `search_text` tool
- [x] 1.6 Validate `columnGroups=["read"]` filtering only returns read tools

## 2. Create integration test for SDK grep event pipeline

- [x] 2.1 Create `src/bun/test/integration/pi-sdk-tool-events.test.ts` — test file
- [x] 2.2 Validate `grep` tool_start → tool_result → done via `ScriptedEngine`
- [x] 2.3 Validate IPC event flow matches `tool_start` → `tool_result` → `tool_done` pattern
- [x] 2.4 Validate DB persistence of SDK tool events
- [x] 2.5 Validate no `search_text` appears in tool registry events

## 3. Validate dependency cleanup

- [x] 3.1 Grep for `picomatch` and `rimraf` in all code
- [x] 3.2 Confirm removal is clean
