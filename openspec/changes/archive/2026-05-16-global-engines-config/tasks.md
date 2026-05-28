## 1. Rename and refactor config/index.ts

- [x] 1.1 Rename private `getDefaultConfigDir()` → `getGlobalConfigDir()` in `src/bun/config/index.ts` and update its 2 callsites within the same file (`getConfigDir` and `loadConfig`)
- [x] 1.2 Rename exported `ensureConfigExists(configDir)` → `ensureWorkspaceConfigExists(configDir)`, removing the `engines.yaml` creation block from it
- [x] 1.3 Add new exported `ensureGlobalConfigExists(globalConfigDir)` that creates `engines.yaml` in the global config dir if absent
- [x] 1.4 Update `loadConfig()` to call `ensureWorkspaceConfigExists(configDir)` and `ensureGlobalConfigExists(globalConfigDir)` (in that order), and change the engine loading line from `loadEnginesConfig(configDir) ?? loadEnginesConfig(globalConfigDir)` to `loadEnginesConfig(globalConfigDir)` only

## 2. Update workspace handler

- [x] 2.1 In `src/bun/handlers/workspace.ts`, update the import to use `ensureWorkspaceConfigExists` instead of `ensureConfigExists`, and update the `workspace.create` handler callsite accordingly

## 3. Verify existing tests pass

- [x] 3.1 Run `bun test src/bun/test/engines-config.test.ts --timeout 20000` and confirm all tests pass without modification
- [x] 3.2 Run `bun test src/bun/test --timeout 20000` and confirm the full backend test suite is green
