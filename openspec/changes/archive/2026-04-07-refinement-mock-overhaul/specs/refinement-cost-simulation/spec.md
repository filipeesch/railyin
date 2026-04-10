## ADDED Requirements

### Requirement: Token estimation from request body
The proxy SHALL estimate token counts for each component of a proxied request body by dividing the JSON-serialized byte length of each component by 4. Components are: tools array, system blocks, messages array, and output (from mock script or response).

#### Scenario: Estimate tokens for a request with tools and messages
- **WHEN** the proxy receives a POST /v1/messages request with 14 tools, a system block, and 5 messages
- **THEN** the proxy computes `tools_tokens = Math.ceil(JSON.stringify(body.tools).length / 4)`, `system_tokens = Math.ceil(JSON.stringify(body.system).length / 4)`, `messages_tokens = Math.ceil(JSON.stringify(body.messages).length / 4)`

#### Scenario: Estimate tokens for a request with no tools
- **WHEN** the proxy receives a request with `tools: []` or no tools field
- **THEN** the proxy sets `tools_tokens = 0`

### Requirement: Cost calculation using Anthropic Sonnet pricing
The proxy SHALL calculate cost estimates using Sonnet 4.6 pricing per million tokens: input=$3.00, cache_write=$6.00, cache_read=$0.30, output=$15.00.

#### Scenario: Cost for a cache miss request
- **WHEN** the prefixKey (tools_hash + system_hash) is not in the prefixMap (cache MISS)
- **THEN** the cost estimate classifies prefix tokens (tools + system) as cache_write at $6.00/MTok, message tokens as input at $3.00/MTok, and output tokens at $15.00/MTok

#### Scenario: Cost for a cache hit request
- **WHEN** the prefixKey is already in the prefixMap (cache HIT)
- **THEN** the cost estimate classifies prefix tokens (tools + system) as cache_read at $0.30/MTok, message tokens as input at $3.00/MTok, and output tokens at $15.00/MTok

### Requirement: Per-request cost breakdown in inspection record
Each InspectionRecord SHALL include a `cost` field containing: tools_tokens, system_tokens, messages_tokens, output_tokens, input_cost, cache_write_cost, cache_read_cost, output_cost, and total_cost.

#### Scenario: Inspection record includes cost data
- **WHEN** the proxy processes a request and creates an InspectionRecord
- **THEN** the record contains a `cost` object with all token counts and cost breakdowns

### Requirement: Scenario cost aggregation in reports
The runner SHALL aggregate cost estimates across all requests in a scenario and include per-scenario totals in the report. The report SHALL also compute an all-cold baseline (every request as cache MISS) and show cache savings as a dollar amount and percentage.

#### Scenario: Report shows scenario cost summary
- **WHEN** a scenario completes with 5 requests (1 miss + 4 hits)
- **THEN** the scenario report includes `total_cost`, `all_cold_cost` (if every request were a miss), and `cache_savings` (all_cold - total) with percentage

#### Scenario: Report shows per-request costs
- **WHEN** a scenario completes
- **THEN** each request in the report includes its individual cost breakdown

### Requirement: Output token estimation for mock mode
In mock mode, the proxy SHALL estimate output tokens from the scripted response entry: for tool_use responses, output_tokens = `Math.ceil(JSON.stringify(entry.input).length / 4) + 20`; for text responses, output_tokens = `Math.ceil(entry.content.length / 4)`.

#### Scenario: Output tokens for a tool_use mock response
- **WHEN** mock mode generates a tool_use response with input `{"path": "src/main.ts"}`
- **THEN** output_tokens is estimated from the serialized tool input plus overhead

#### Scenario: Output tokens for a text mock response
- **WHEN** mock mode generates a text response with content "Done."
- **THEN** output_tokens is estimated from the content length divided by 4
