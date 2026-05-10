# Test Plan: Validate search_text removal and SDK search tool replacement

## Why

After `fix-pi-search` removes the broken `search_text` tool and replaces it with Pi SDK's built-in `grep`/`find`/`ls`, we need test coverage to validate:

1. **Tool registration**: `PI_TOOL_GROUPS` has 4 groups (read, write, shell, web); no search
2. **Default filtering**: `DEFAULT_PI_TOOL_GROUPS` has 3 groups (read, write, shell); no search
3. **buildAllTools()**: Returns correct tool names, no `search_text` anywhere
4. **`columnGroups` filtering**: `buildAllTools(columnGroups=["read"])` only returns read tools
5. **SDK `grep` integration**: SDK `grep` tool events flow correctly through IPC → DB
6. **Dependency cleanup**: `picomatch` and `rimraf` no longer imported

## Capability

### Modified Capabilities
- `test-pi-search`: Replace broken `search_text` test coverage with SDK `grep` pipeline validation

### New Capabilities
<none>
