## 1. Test Infrastructure Fixes

- [x] 1.1 Update `src/bun/test/helpers.ts` `initDb()` to add `enabled_mcp_tools TEXT` column to the `tasks` table (mirrors production schema)
- [x] 1.2 Update `e2e/ui/fixtures/mock-data.ts` `makeTask()` default from `enabledMcpTools: null` to `enabledMcpTools: []`
- [x] 1.3 Update `e2e/ui/fixtures/mock-data.ts` `makeChatSession()` default from `enabledMcpTools: null` to `enabledMcpTools: []`

## 2. Config Loader Unit Tests

- [x] 2.1 Create `src/bun/test/mcp-config-loader.test.ts`
- [x] 2.2 Add tests for `normalizeToMcpConfig`: empty/null input → `{ servers: [] }`
- [x] 2.3 Add tests for `normalizeToMcpConfig`: array-format passthrough
- [x] 2.4 Add tests for `normalizeToMcpConfig`: VS Code object-map → stdio entry conversion
- [x] 2.5 Add tests for `normalizeToMcpConfig`: VS Code object-map → http entry with headers
- [x] 2.6 Add tests for `normalizeToMcpConfig`: multiple servers in object-map
- [x] 2.7 Add tests for `loadMcpConfigFile`: non-existent path returns `{ servers: [] }`
- [x] 2.8 Add tests for `loadMcpConfigFile`: valid JSON file parsed and normalized
- [x] 2.9 Add tests for `loadMcpConfigFile`: malformed JSON throws `SyntaxError`

## 3. McpRegistryPool Unit Tests

- [x] 3.1 Create `src/bun/test/mcp-registry-pool.test.ts`
- [x] 3.2 Add test: `getGlobalRegistry()` when global config exists — calls factory with parsed config
- [x] 3.3 Add test: `getGlobalRegistry()` when no config — calls factory with `{ servers: [] }`
- [x] 3.4 Add test: `getForProject(path)` when project config exists — calls factory with project config, returns project-specific instance
- [x] 3.5 Add test: `getForProject(path)` when project config absent — returns same instance as global
- [x] 3.6 Add test: same project path called twice — factory called once, same instance returned
- [x] 3.7 Add test: different project paths — factory called twice, distinct instances
- [x] 3.8 Add test: `shutdown()` propagates to all cached registries

## 4. ExecutionParamsBuilder Unit Test Updates

- [x] 4.1 Update existing `null` test in `execution-params-builder.test.ts`: `null` DB value → `enabledMcpTools: []`
- [x] 4.2 Update or add test: `'[]'` DB value → `enabledMcpTools: []`
- [x] 4.3 Add test: malformed JSON → `enabledMcpTools: []` (no throw)
- [x] 4.4 Add test: `build()` with pool DI — `params.mcpRegistry` comes from `pool.getForProject(resolvedProjectPath)`
- [x] 4.5 Add test: `buildForChat()` with pool DI — `params.mcpRegistry` comes from `pool.getGlobalRegistry()`

## 5. DB Migration Test

- [x] 5.1 Add test case to `src/bun/test/db-migrations.test.ts` for migration 044
- [x] 5.2 Seed tasks with `enabled_mcp_tools = NULL` and `'["a:b"]'` before migration
- [x] 5.3 Seed chat_sessions with `enabled_mcp_tools = NULL` and `'[]'` before migration
- [x] 5.4 Assert: after migration, all NULL task rows → `'[]'`; non-null values unchanged
- [x] 5.5 Assert: after migration, all NULL session rows → `'[]'`; non-null values unchanged

## 6. MCP Handler Unit Tests

- [x] 6.1 Add `mcp.getProjectConfig` test: resolved config exists → returns `{ path, content }`
- [x] 6.2 Add `mcp.getProjectConfig` test: resolved config absent → returns empty template with correct path
- [x] 6.3 Add `mcp.getProjectConfig` test: unknown project key → throws
- [x] 6.4 Add `mcp.saveProjectConfig` test: valid JSON → file written to `<projectPath>/.railyn/mcp.json`
- [x] 6.5 Add `mcp.saveProjectConfig` test: `.railyn/` dir created when absent
- [x] 6.6 Add `mcp.saveProjectConfig` test: invalid JSON → throws before writing
- [x] 6.7 Add `mcp.saveProjectConfig` test: pool cache invalidated after save

## 7. Playwright — Fix Broken Existing Tests

- [x] 7.1 Update V-12: `enabledMcpTools: []` → all checkboxes unchecked (was: null = all checked)
- [x] 7.2 Update V-24/V-25: toggling all on/off produces explicit array, never `null`

## 8. Playwright — New Suites

- [x] 8.1 Add Suite B-1: task with `enabledMcpTools: []` → all server checkboxes unchecked
- [x] 8.2 Add Suite B-2: task with `enabledMcpTools: []` → all individual tool rows unchecked
- [x] 8.3 Add Suite B-3: task with one tool enabled → only that row checked
- [x] 8.4 Add Suite B-4: partial tool selection → server checkbox in indeterminate state
- [x] 8.5 Add Suite C-1: task chat with `projectKey` → both edit buttons visible
- [x] 8.6 Add Suite C-2: "Edit global mcp.json" click → calls `mcp.getConfig`, shows global path
- [x] 8.7 Add Suite C-3: "Edit project mcp.json" click → calls `mcp.getProjectConfig` with correct keys
- [x] 8.8 Add Suite C-4: saving project config editor → calls `mcp.saveProjectConfig`
- [x] 8.9 Add Suite D-1: session chat → only "Edit global mcp.json" visible, project button absent from DOM
- [x] 8.10 Add Suite D-2: session "Edit global mcp.json" → `mcp.getConfig` called, editor opens
