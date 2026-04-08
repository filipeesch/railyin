## Purpose
The refinement proxy is an HTTP server that sits between the engine and the AI backend during refinement runs. It intercepts Anthropic Messages API requests, inspects them, simulates cache prefix behavior, and — in mock mode — returns scripted responses without forwarding to any backend.

## Requirements

### Requirement: Proxy intercepts Anthropic Messages API requests
The system SHALL provide a Bun.serve HTTP server (`refinement/proxy.ts`) that listens on a configurable port (default 8999) and accepts `POST /v1/messages` requests in the Anthropic Messages API format. The proxy SHALL forward requests to a backend URL determined by the `--mode` flag.

#### Scenario: Proxy starts and accepts requests
- **WHEN** the proxy is started with `bun refinement/proxy.ts --mode mock --port 8999`
- **THEN** it listens on `http://localhost:8999` and responds to `POST /v1/messages`

#### Scenario: Request forwarded to backend in local mode
- **WHEN** the proxy receives a `POST /v1/messages` request in `--mode local`
- **THEN** the full request body is forwarded unmodified to the backend URL (default `http://localhost:1234`)

#### Scenario: Request forwarded to backend in live mode
- **WHEN** the proxy receives a `POST /v1/messages` request in `--mode live`
- **THEN** the full request body is forwarded unmodified to `https://api.anthropic.com`

### Requirement: Proxy inspects every request
The system SHALL parse the JSON body of every incoming request and log a structured inspection record containing: `tools_count`, `tools_hash` (SHA256 of sorted tool definitions JSON), `system_hash` (SHA256 of system content), `cache_control_present` (boolean), `max_tokens`, and `message_count`. Each record SHALL include a monotonically increasing `request_id` and a `timestamp`.

#### Scenario: Inspection record logged for each request
- **WHEN** a request arrives with 17 tools, a system prompt, `cache_control` present, and `max_tokens: 8192`
- **THEN** the proxy logs `{ request_id: 1, tools_count: 17, tools_hash: "<sha256>", system_hash: "<sha256>", cache_control_present: true, max_tokens: 8192, message_count: N, timestamp: "<iso>" }`

#### Scenario: Tools hash computed from sorted definitions
- **WHEN** two requests contain the same tools in different order
- **THEN** both produce the same `tools_hash` (tools are sorted alphabetically by name before hashing)

### Requirement: Proxy simulates cache prefix behavior
The system SHALL maintain a map of `{ tools_hash + system_hash → last_seen_request_id }` per execution context. When a request's combined hash matches a previous request in the same context, the proxy SHALL classify it as a cache HIT. When it differs, it SHALL classify it as a cache MISS (cold write). The classification SHALL be logged and, in mock/local modes, injected into the SSE response's `message_start` usage stats as synthetic `cache_read_input_tokens` (HIT) or `cache_creation_input_tokens` (MISS).

#### Scenario: Cache HIT when prefix matches
- **WHEN** two consecutive requests have identical `tools_hash` and `system_hash`
- **THEN** the second request is classified as `cache_hit: true` and logged accordingly

#### Scenario: Cache MISS when tools differ between parent and sub-agent
- **WHEN** a parent request has `tools_hash: "abc123"` and a sub-agent request has `tools_hash: "def456"`
- **THEN** the sub-agent request is classified as `cache_hit: false` and logged as a prefix mismatch

#### Scenario: Synthetic usage injection in mock mode
- **WHEN** mode is `mock` and a cache HIT occurs
- **THEN** the `message_start` SSE event includes `cache_read_input_tokens` > 0 and `cache_creation_input_tokens: 0`

### Requirement: Proxy returns scripted responses in mock mode
In `--mode mock`, the system SHALL NOT forward requests to any backend. Instead, it SHALL read the active scenario file and return the next scripted response as a valid Anthropic SSE stream. If no scenario is loaded or the script is exhausted, it SHALL return a simple text completion response.

#### Scenario: Scripted tool_use response returned
- **WHEN** mode is `mock` and the scenario script's next entry is `{ respond_with: "tool_use", tool: "read_file", input: { file_path: "src/main.ts" } }`
- **THEN** the proxy returns an SSE stream with `content_block_start` (type: tool_use), `content_block_delta` (input_json_delta), and `message_delta` (stop_reason: tool_use)

#### Scenario: Scripted text response returned
- **WHEN** mode is `mock` and the scenario script's next entry is `{ respond_with: "text", content: "Done." }`
- **THEN** the proxy returns an SSE stream with `content_block_start` (type: text), `content_block_delta` (text_delta), and `message_delta` (stop_reason: end_turn)

### Requirement: Proxy passes through SSE responses in local and live modes
In `--mode local` and `--mode live`, the system SHALL stream the backend's SSE response directly to the caller without modification, except for optional usage stat injection in local mode (cache simulation).

#### Scenario: SSE passthrough in live mode
- **WHEN** mode is `live` and the backend returns an SSE stream
- **THEN** the proxy forwards every SSE event to the caller unmodified

### Requirement: Proxy supports configurable backend URL
The system SHALL accept a `--backend` CLI flag to override the default backend URL for each mode (mock: none, local: `http://localhost:1234`, live: `https://api.anthropic.com`).

#### Scenario: Custom backend URL
- **WHEN** the proxy is started with `--mode local --backend http://localhost:11434`
- **THEN** requests are forwarded to `http://localhost:11434/v1/messages`
