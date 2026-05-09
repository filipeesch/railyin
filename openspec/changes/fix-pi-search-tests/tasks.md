# Implementation Tasks

## 1. Create unit tests for PI_TOOL_GROUPS and buildAllTools

- [ ] 1.1 Create `src/bun/test/pi-tool-registry.test.ts` — test file
- [ ] 1.2 Validate `PI_TOOL_GROUPS` has exactly 4 entries (read, write, shell, web)
- [ ] 1.3 Validate `DEFAULT_PI_TOOL_GROUPS` has exactly 3 entries (read, write, shell)
- [ ] 1.4 Validate `buildAllTools()` returns tools matching the 4 named groups
- [ ] 1.5 Validate `buildAllTools()` returns no `search_text` tool
- [ ] 1.6 Validate `columnGroups=["read"]` filtering only returns read tools

## 2. Create integration test for SDK grep event pipeline

- [ ] 2.1 Create `src/bun/test/pi-sdk-tool-events.test.ts` — test file
- [ ] 2.2 Validate `grep` tool_start → tool_result → done via `ScriptedEngine`
- [ ] 2.3 Validate IPC event flow matches `tool_start` → `tool_result` → `tool_done` pattern
- [ ] 2.4 Validate DB persistence of SDK tool events
- [ ] 2.5 Validate no `search_text` appears in tool registry events

## 3. Validate dependency cleanup

- [ ] 3.1 Grep for `picomatch` and `rimraf` in all code
- [ ] 3.2 Confirm removal is clean
