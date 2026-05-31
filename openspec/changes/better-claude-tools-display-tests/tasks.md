## 1. Shared display utilities (`src/bun/engine/__tests__/tool-display.test.ts`)

- [ ] 1.1 Add `describe("stripRailyinMcpPrefix")` with cases: strips `mcp__railyin__decision_request` → `decision_request`; strips `mcp__railyin__report_intent` → `report_intent`; leaves `mcp__other-server__do_thing` unchanged; leaves `bash` unchanged; handles empty string safely
- [ ] 1.2 Add `describe("humanizeToolName")` with cases: `some_custom_tool` → `some custom tool`; `mcp__other-server__do_thing` → `other-server do thing`; `mcp__my_server__list_items` → `my server list items`; `bash` → `bash`; `mcp__railyin__decision_request` → `railyin decision request`
- [ ] 1.3 Add `describe("stripWorktreePath")` with cases: strips absolute prefix from file path; handles trailing slash in `worktreePath`; leaves non-matching subject unchanged; returns `undefined` for empty/undefined subject; no-ops when `worktreePath` is absent

## 2. Claude engine tests (`src/bun/test/claude-events.test.ts`)

- [ ] 2.1 Add `describe("MCP-prefixed railyin tool display routing")` — `mcp__railyin__decision_request` → `display.label = "decision request"`; `mcp__railyin__record_decision` → `display.label = "record decision"` with non-empty label
- [ ] 2.2 Add `describe("isInternalClaudeToolName with MCP prefix")` — `mcp__railyin__report_intent` → `isInternal: true`; `mcp__railyin__internal_fallback` → `isInternal: true`; `mcp__railyin__decision_request` → `isInternal: false`
- [ ] 2.3 Add cases in existing unknown-tool describe (or new describe) — `mcp__other-server__do_thing` → `display.label = "other-server do thing"`; `my_custom_tool` → `display.label = "my custom tool"`

## 3. OpenCode event tests (`src/bun/test/opencode-events.test.ts`)

- [ ] 3.1 Amend the existing `"maps running state to tool_start event"` test to also assert `display` is present and has a non-null `label`
- [ ] 3.2 Add new case: `"move_task"` running state → `display.label = "move task"`
- [ ] 3.3 Add new case: `"my_custom_tool"` running state → `display.label = "my custom tool"`

## 4. Copilot engine tests (`src/bun/test/copilot-events.test.ts`)

- [ ] 4.1 Add `it("unknown tool name is humanized — underscores replaced with spaces")` — stream `tool.execution_start` for `"my_custom_tool"`, collect events, assert `tool_start.display.label = "my custom tool"`

## 5. Playwright test (`e2e/ui/stream-reactivity.spec.ts`)

- [ ] 5.1 Add `test("A-3: tool_call with humanized label renders in .tc__tool-name")` — push a `tool_call` stream event with `display.label = "other-server do thing"`, assert `.conv-body .tc__tool-name` contains `"other-server do thing"`
