## 1. Test Infrastructure Fixes

- [ ] 1.1 Update `src/bun/test/helpers.ts` `initDb()` to add `enabled_mcp_tools TEXT` column to the `tasks` table (mirrors production schema)
- [ ] 1.2 Update `e2e/ui/fixtures/mock-data.ts` `makeTask()` default from `enabledMcpTools: null` to `enabledMcpTools: []`
- [ ] 1.3 Update `e2e/ui/fixtures/mock-data.ts` `makeChatSession()` default from `enabledMcpTools: null` to `enabledMcpTools: []`

## 2. Config Loader Unit Tests

- [ ] 2.1 Create `src/bun/test/mcp-config-loader.test.ts`
- [ ] 2.2 Add tests for `normalizeToMcpConfig`: empty/null input → `{ servers: [] }`
- [ ] 2.3 Add tests for `normalizeToMcpConfig`: array-format passthrough
- [ ] 2.4 Add tests for `normalizeToMcpConfig`: VS Code object-map → stdio entry conversion
- [ ] 2.5 Add tests for `normalizeToMcpConfig`: VS Code object-map → http entry with headers
- [ ] 2.6 Add tests for `normalizeToMcpConfig`: multiple servers in object-map
- [ ] 2.7 Add tests for `loadMcpConfigFile`: non-existent path returns `{ servers: [] }`
- [ ] 2.8 Add tests for `loadMcpConfigFile`: valid JSON file parsed and normalized
- [ ] 2.9 Add tests for `loadMcpConfigFile`: malformed JSON throws `SyntaxError`

## 3. McpRegistryPool Unit Tests

- [ ] 3.1 Create `src/bun/test/mcp-registry-pool.test.ts`
- [ ] 3.2 Add test: `getGlobalRegistry()` when global config exists — calls factory with parsed config
- [ ] 3.3 Add test: `getGlobalRegistry()` when no config — calls factory with `{ servers: [] }`
- [ ] 3.4 Add test: `getForProject(path)` when project config exists — calls factory with project config, returns project-specific instance
- [ ] 3.5 Add test: `getForProject(path)` when project config absent — returns same instance as global
- [ ] 3.6 Add test: same project path called twice — factory called once, same instance returned
- [ ] 3.7 Add test: different project paths — factory called twice, distinct instances
- [ ] 3.8 Add test: `shutdown()` propagates to all cached registries

## 4. ExecutionParamsBuilder Unit Test Updates

- [ ] 4.1 Update existing `null` test in `execution-params-builder.test.ts`: `null` DB value → `enabledMcpTools: []`
- [ ] 4.2 Update or add test: `'[]'` DB value → `enabledMcpTools: []`
- [ ] 4.3 Add test: malformed JSON → `enabledMcpTools: []` (no throw)
- [ ] 4.4 Add test: `build()` with pool DI — `params.mcpRegistry` comes from `pool.getForProject(resolvedProjectPath)`
- [ ] 4.5 Add test: `buildForChat()` with pool DI — `params.mcpRegistry` comes from `pool.getGlobalRegistry()`

## 5. DB Migration Test

- [ ] 5.1 Add test case to `src/bun/test/db-migrations.test.ts` for migration 044
- [ ] 5.2 Seed tasks with `enabled_mcp_tools = NULL` and `'["a:b"]'` before migration
- [ ] 5.3 Seed chat_sessions with `enabled_mcp_tools = NULL` and `'[]'` before migration
- [ ] 5.4 Assert: after migration, all NULL task rows → `'[]'`; non-null values unchanged
- [ ] 5.5 Assert: after migration, all NULL session rows → `'[]'`; non-null values unchanged

## 6. MCP Handler Unit Tests

- [ ] 6.1 Add `mcp.getProjectConfig` test: resolved config exists → returns `{ path, content }`
- [ ] 6.2 Add `mcp.getProjectConfig` test: resolved config absent → returns empty template with correct path
- [ ] 6.3 Add `mcp.getProjectConfig` test: unknown project key → throws
- [ ] 6.4 Add `mcp.saveProjectConfig` test: valid JSON → file written to `<projectPath>/.railyn/mcp.json`
- [ ] 6.5 Add `mcp.saveProjectConfig` test: `.railyn/` dir created when absent
- [ ] 6.6 Add `mcp.saveProjectConfig` test: invalid JSON → throws before writing
- [ ] 6.7 Add `mcp.saveProjectConfig` test: pool cache invalidated after save

## 7. Playwright — Fix Broken Existing Tests

- [ ] 7.1 Update V-12: `enabledMcpTools: []` → all checkboxes unchecked (was: null = all checked)
- [ ] 7.2 Update V-24/V-25: toggling all on/off produces explicit array, never `null`

## 8. Playwright — New Suites

- [ ] 8.1 Add Suite B-1: task with `enabledMcpTools: []` → all server checkboxes unchecked
- [ ] 8.2 Add Suite B-2: task with `enabledMcpTools: []` → all individual tool rows unchecked
- [ ] 8.3 Add Suite B-3: task with one tool enabled → only that row checked
- [ ] 8.4 Add Suite B-4: partial tool selection → server checkbox in indeterminate state
- [ ] 8.5 Add Suite C-1: task chat with `projectKey` → both edit buttons visible
- [ ] 8.6 Add Suite C-2: "Edit global mcp.json" click → calls `mcp.getConfig`, shows global path
- [ ] 8.7 Add Suite C-3: "Edit project mcp.json" click → calls `mcp.getProjectConfig` with correct keys
- [ ] 8.8 Add Suite C-4: saving project config editor → calls `mcp.saveProjectConfig`
- [ ] 8.9 Add Suite D-1: session chat → only "Edit global mcp.json" visible, project button absent from DOM
- [ ] 8.10 Add Suite D-2: session "Edit global mcp.json" → `mcp.getConfig` called, editor opens
