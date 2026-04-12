## ADDED Requirements

### Requirement: Per-request timing timestamps
The proxy SHALL record three timestamps for every proxied request: `request_received_at` (ms since epoch when the request handler starts), `first_byte_at` (ms since epoch when the first SSE chunk arrives from the backend), and `last_byte_at` (ms since epoch when the response stream ends).

#### Scenario: Timestamps recorded for a local mode request
- **WHEN** the proxy processes a request in local mode that takes 2 seconds for TTFB and 3 seconds total
- **THEN** the timing record has `request_received_at` ≈ T, `first_byte_at` ≈ T+2000, `last_byte_at` ≈ T+3000

#### Scenario: Timestamps for mock mode are near-instant
- **WHEN** the proxy processes a request in mock mode
- **THEN** `request_received_at`, `first_byte_at`, and `last_byte_at` are all within a few milliseconds of each other

### Requirement: Derived timing fields
Each timing record SHALL include derived fields: `ttfb_ms` = `first_byte_at - request_received_at` and `duration_ms` = `last_byte_at - request_received_at`.

#### Scenario: TTFB and duration computed from timestamps
- **WHEN** a request has `request_received_at=1000`, `first_byte_at=2500`, `last_byte_at=4000`
- **THEN** the timing record has `ttfb_ms=1500` and `duration_ms=3000`

### Requirement: Timing stored in capture file
Each per-request capture JSON file SHALL include a `timing` field containing the `RequestTiming` object with all timestamp and derived fields.

#### Scenario: Capture file includes timing data
- **WHEN** a request capture file is written
- **THEN** the JSON file contains a `timing` field with `request_received_at`, `first_byte_at`, `last_byte_at`, `ttfb_ms`, and `duration_ms`

### Requirement: Per-scenario timing aggregation in reports
The scenario report SHALL include aggregate timing metrics: `total_model_time_ms` (sum of all request `duration_ms`), `avg_ttfb_ms` (mean of all request `ttfb_ms`), and `scenario_duration_ms` (wall time from first request received to last request completed).

#### Scenario: Scenario report includes timing summary for local mode
- **WHEN** a local mode scenario completes with 4 requests
- **THEN** the scenario report includes `total_model_time_ms`, `avg_ttfb_ms`, and `scenario_duration_ms`

#### Scenario: Mock mode timing summary shows near-zero values
- **WHEN** a mock mode scenario completes
- **THEN** `total_model_time_ms` and `avg_ttfb_ms` are near zero

### Requirement: Tool execution gap derivation
The analysis phase SHALL compute per-request `tool_exec_gap_ms` as the time between one request's `last_byte_at` and the next request's `request_received_at`. This represents the time spent executing tools between AI calls.

#### Scenario: Tool execution gap for sequential requests
- **WHEN** request 1 has `last_byte_at=3000` and request 2 has `request_received_at=4200`
- **THEN** the tool execution gap between request 1 and request 2 is 1200ms
