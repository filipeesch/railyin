## ADDED Requirements

### Requirement: Full request body capture per proxied request
The proxy SHALL store the complete parsed request body for every POST /v1/messages request it processes, including: model, max_tokens, stream, tools (full array), system (full blocks), and messages (full array).

#### Scenario: Proxy captures request body
- **WHEN** the proxy receives a POST /v1/messages request
- **THEN** the proxy stores the full parsed body keyed by request_id in its state

### Requirement: Per-request JSON files in report directory
The runner SHALL write each captured request body as a numbered JSON file in a `requests/` subdirectory of the report directory. Each file SHALL contain the raw request body, the inspection record, and the cost estimate for that request.

#### Scenario: Report directory contains per-request files
- **WHEN** a scenario run completes with 3 proxied requests
- **THEN** the report directory contains `requests/001.json`, `requests/002.json`, `requests/003.json`

#### Scenario: Per-request file structure
- **WHEN** a per-request JSON file is written
- **THEN** it contains `request_id`, `body` (full request body), `inspection` (the InspectionRecord), and `cost` (the CostEstimate)

### Requirement: Tool name extraction in inspection record
Each InspectionRecord SHALL include a `tools_names` field containing the ordered list of tool names extracted from the request body's tools array.

#### Scenario: Tool names extracted from request
- **WHEN** the proxy processes a request with tools `[{name: "read_file", ...}, {name: "edit_file", ...}]`
- **THEN** the inspection record's `tools_names` field is `["read_file", "edit_file"]`

### Requirement: Request labeling
Each captured request SHALL include a `label` field identifying whether it is a parent request or a sub-agent request. The proxy SHALL determine this from the presence of an `x-agent-label` header or by inferring from the system prompt content.

#### Scenario: Parent request labeling
- **WHEN** a request has no agent label header and the system prompt does not contain "sub-agent"
- **THEN** the request label is `"parent"`

#### Scenario: Sub-agent request labeling
- **WHEN** a request includes an `x-agent-label` header with value `"Agent 1/2"`
- **THEN** the request label is `"Agent 1/2"`

### Requirement: Mock mode routes through engine
In mock mode, the runner SHALL use the `engine-runner.ts` path (same as local/live) to drive scenarios. The engine SHALL resolve tools from column config, assemble system messages, and call the AI provider — which hits the proxy. The proxy returns scripted SSE responses.

#### Scenario: Mock mode exercises tool resolution
- **WHEN** a scenario runs in mock mode with `column_tools: [read, write, search]`
- **THEN** the proxy receives requests with the resolved tool set (read_file, write_file, edit_file, search_text, find_files) — not an empty array

#### Scenario: Mock mode exercises system prompt assembly
- **WHEN** a scenario runs in mock mode
- **THEN** the proxy receives requests with system blocks containing stage instructions and worktree context — not a hardcoded test string

### Requirement: Scenario column tools configuration
Each scenario YAML file SHALL support a `column_tools` field that specifies the tool groups for the scenario's workflow column. This uses the same group names as production workflow YAML (read, write, search, shell, interactions, agents, web, todos, lsp).

#### Scenario: Scenario declares column tools
- **WHEN** a scenario YAML contains `column_tools: [read, search, agents]`
- **THEN** the engine-runner creates a temporary workflow config with a column that has `tools: [read, search, agents]`

#### Scenario: Default column tools
- **WHEN** a scenario YAML does not specify `column_tools`
- **THEN** the engine-runner uses the default tool set: `[read, write, search, shell, interactions, agents]`
