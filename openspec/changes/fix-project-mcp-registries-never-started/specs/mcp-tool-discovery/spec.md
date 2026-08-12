## ADDED Requirements

### Requirement: Discovery tools await registry readiness
All three discovery/invocation executor functions (`execListMcpServers`, `execListMcpTools`, `execInvokeMcpTool`) SHALL call `await registry.ensureStarted()` before reading server status, listing tools, or invoking a tool, so a freshly-created project registry whose servers are still `starting` is waited on rather than observed as `idle`. All three SHALL return `Promise<string>`.

#### Scenario: list_mcp_servers waits for servers to start
- **WHEN** `execListMcpServers` is called on a project registry whose servers are still starting
- **THEN** it awaits `ensureStarted()` and reports servers as `running` (or `error`/`auth_required`/`disabled` once the start settles)

#### Scenario: list_mcp_tools waits for server to run
- **WHEN** `execListMcpTools` is called
- **THEN** it awaits `ensureStarted()` before filtering the server's cached tool list

#### Scenario: invoke_mcp_tool waits for server to run
- **WHEN** `execInvokeMcpTool` is called
- **THEN** it awaits `ensureStarted()` before dispatching `callTool`

#### Scenario: Project-scoped server reaches running (integration)
- **WHEN** a task execution runs in a project whose `.railyn/mcp.json` declares a local stdio MCP server (backend-rpc-runtime harness, in-memory DB; the `mcp.getStatus` RPC is global-only, so the project scope is observed through the execution's MCP tools)
- **THEN** `list_mcp_servers` reports the server `running` (never `idle`), and `invoke_mcp_tool` against it succeeds (the `grafana-mcpar` shape)
