## ADDED Requirements

### Requirement: Streaming SSE response capture during passthrough
The proxy SHALL capture the full SSE response for every proxied request in local and live modes by accumulating decoded SSE chunks in a side-channel array during the existing TransformStream passthrough. The capture SHALL NOT buffer or delay the response stream to the client.

#### Scenario: Response captured without delaying client stream
- **WHEN** the proxy forwards a request to the backend in local mode and streams the SSE response back to the client
- **THEN** each SSE chunk is simultaneously written to the client stream and appended to an internal `chunks: string[]` accumulator, with no added latency to the client

#### Scenario: Response capture for live mode passthrough
- **WHEN** the proxy forwards a request in live mode (currently pure passthrough)
- **THEN** the proxy uses the same TransformStream + accumulator pattern as local mode to capture the response while streaming

### Requirement: Parse accumulated SSE into ResponseCapture
After the response stream ends, the proxy SHALL parse the accumulated SSE string into a `ResponseCapture` object containing: `stop_reason` (string), `content_blocks` (array of text, tool_use, or thinking blocks), `usage` (with `output_tokens`), and `model` (string).

#### Scenario: Parse a text response
- **WHEN** the accumulated SSE contains a `content_block_start` with type "text", `content_block_delta` with text content, and `message_delta` with stop_reason "end_turn"
- **THEN** the resulting `ResponseCapture` has `stop_reason: "end_turn"`, one content block of type "text" with the concatenated text, and `usage.output_tokens` from the `message_delta` event

#### Scenario: Parse a tool_use response
- **WHEN** the accumulated SSE contains a `content_block_start` with type "tool_use" (id, name), `input_json_delta` chunks, and `message_delta` with stop_reason "tool_use"
- **THEN** the resulting `ResponseCapture` has `stop_reason: "tool_use"`, one content block of type "tool_use" with parsed input JSON, and the tool name and id

#### Scenario: Parse a response with thinking blocks
- **WHEN** the accumulated SSE contains content blocks of type "thinking"
- **THEN** the resulting `ResponseCapture` includes a content block of type "thinking" with the accumulated thinking text

#### Scenario: Parse failure falls back to empty capture
- **WHEN** the accumulated SSE string is malformed or the parser fails
- **THEN** the resulting `ResponseCapture` has `stop_reason: "unknown"`, empty `content_blocks`, and `usage.output_tokens: 0`

### Requirement: Synthesize ResponseCapture for mock mode
In mock mode, the proxy SHALL construct a `ResponseCapture` from the script entry used to generate the mock SSE, so that capture files have the same structure across all modes.

#### Scenario: Mock text response produces ResponseCapture
- **WHEN** mock mode generates a response from a script entry with `respond_with: text` and `content: "Done."`
- **THEN** the synthesized `ResponseCapture` has `stop_reason: "end_turn"`, one text content block with text "Done.", and estimated output_tokens

#### Scenario: Mock tool_use response produces ResponseCapture
- **WHEN** mock mode generates a response from a script entry with `respond_with: tool_use`, `tool: "edit_file"`, and `input: {...}`
- **THEN** the synthesized `ResponseCapture` has `stop_reason: "tool_use"`, one tool_use content block with the tool name and input

### Requirement: ResponseCapture stored in capture file
Each per-request capture JSON file SHALL include a `response` field containing the `ResponseCapture` object, alongside the existing `body`, `inspection`, `cost`, and new `timing` fields.

#### Scenario: Capture file includes response data
- **WHEN** a request completes and the capture file is written
- **THEN** the JSON file contains `{ request_id, body, response, inspection, cost, timing }` with `response` being the parsed `ResponseCapture`

### Requirement: Update InspectionRecord with real output_tokens
For local and live modes, after parsing the response, the proxy SHALL update the `InspectionRecord.cost.output_tokens` with the real value from `ResponseCapture.usage.output_tokens` and recalculate `output_cost` and `total_cost`.

#### Scenario: Output tokens updated from real response in local mode
- **WHEN** a local mode request completes and the parsed response has `usage.output_tokens = 142`
- **THEN** the InspectionRecord's `cost.output_tokens` is set to 142 and `cost.output_cost` is recalculated as `(142 / 1_000_000) * 15.0`
