# Design: Test Suite for Pi Engine Search Replacement

## Test Structure

### Unit Tests: `pi-tool-registry.test.ts`

Validates tool registration and filtering after search removal:

**Spec Coverage:**
- V1: `PI_TOOL_GROUPS` has 4 groups (read, write, shell, web)
- V2: `DEFAULT_PI_TOOL_GROUPS` has 3 groups (read, write, shell)
- V3: `buildAllTools()` returns tools matching the 4 groups; no `search_text`
- V4: `buildAllTools(columnGroups=["read"])` only returns read tools
- V5: `buildAllTools(columnGroups=["shell"])` only returns shell tools

**Test infrastructure:**
- Uses mocked `PiToolHarnessContext` + `EngineCommonContext`
- Imports from `src/bun/engine/pi/tools/index.ts`
- Validates tool `name` properties for exact match
- Validates tool `type` properties (check, write, exec, agent)

### Integration Tests: `pi-sdk-tool-events.test.ts`

Validates SDK `grep`/`find`/`ls` event pipeline:

**Spec Coverage:**
- V5: SDK `grep` tool_start → tool_result → done pipeline via `ScriptedEngine`
- V6: No `search_text` appears in tool registry

**Test infrastructure:**
- `ScriptedEngine`: Scripted event queues for `grep`, `find`, `ls` tool events
- `BackendRpcRuntime`: In-memory SQLite with orchestration
- Validates `tool_start` → `tool_result` events through IPC → DB
- Validates persistence of tool events

### Key Design

1. **Unit tests are 100% pure** — No external dependencies, only mock contexts
2. **Integration tests leverage existing infrastructure** — `ScriptedEngine`, `BackendRpcRuntime`
3. **No E2E UI tests needed** — `e2e/ui/tool-rendering.spec.ts` is UI-agnostic
4. **Tests are independent** — Unit tests run without feature PR; integration tests require `fix-pi-search` to be applied
