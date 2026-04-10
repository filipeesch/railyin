## MODIFIED Requirements

### Requirement: Output token estimation for mock mode
In mock mode, the proxy SHALL estimate output tokens from the scripted response entry: for tool_use responses, output_tokens = `Math.ceil(JSON.stringify(entry.input).length / 4) + 20`; for text responses, output_tokens = `Math.ceil(entry.content.length / 4)`. In local and live modes, the proxy SHALL use the real `output_tokens` value parsed from the response SSE stream instead of defaulting to 0.

#### Scenario: Output tokens for a tool_use mock response
- **WHEN** mock mode generates a tool_use response with input `{"path": "src/main.ts"}`
- **THEN** output_tokens is estimated from the serialized tool input plus overhead

#### Scenario: Output tokens for a text mock response
- **WHEN** mock mode generates a text response with content "Done."
- **THEN** output_tokens is estimated from the content length divided by 4

#### Scenario: Output tokens from real response in local mode
- **WHEN** local mode receives a response with `message_delta` containing `usage.output_tokens: 89`
- **THEN** the cost estimate uses `output_tokens = 89` and `output_cost = (89 / 1_000_000) * 15.0`

#### Scenario: Output tokens from real response in live mode
- **WHEN** live mode receives a response with `message_delta` containing `usage.output_tokens: 142`
- **THEN** the cost estimate uses `output_tokens = 142`
