## MODIFIED Requirements

### Requirement: ClaudeEngine exposes common tools with full parameter schemas
The system SHALL translate JSON Schema parameter definitions into Zod shapes when registering MCP tools via the Claude Agent SDK. The translation SHALL support scalar types (`string`, `number`, `boolean`), enum-constrained strings, nested `array` types (with recursively translated item schemas), and nested `object` types (with recursively translated property shapes). Parameters whose JSON Schema type is unrecognized SHALL fall back to `z.any()`. The resulting Zod shapes SHALL produce complete, typed MCP `inputSchema` entries in the `tools/list` response seen by Claude Code.

#### Scenario: String enum parameter is translated to typed enum schema

- **WHEN** a common tool has a parameter defined as `{ type: "string", enum: ["a","b","c"] }`
- **THEN** the MCP tools/list entry for that parameter contains `{ "type": "string", "enum": ["a","b","c"] }`

#### Scenario: Array parameter is translated to typed array schema

- **WHEN** a common tool has a parameter defined as `{ type: "array", items: { type: "object", properties: {...} } }`
- **THEN** the MCP tools/list entry for that parameter contains `{ "type": "array", "items": { "type": "object", "properties": {...} } }`

#### Scenario: Object parameter is translated to typed object schema

- **WHEN** a common tool has a parameter defined as `{ type: "object", properties: { name: { type: "string" } } }`
- **THEN** the MCP tools/list entry for that parameter contains `{ "type": "object", "properties": { "name": { "type": "string" } } }`

#### Scenario: interview_me questions array is fully typed in MCP listing

- **WHEN** the Claude engine registers the `interview_me` tool
- **THEN** the MCP tools/list entry for `questions` includes `type: "array"` with an `items` object that contains the `type` enum field with values `exclusive`, `non_exclusive`, `freetext`

#### Scenario: Unknown type falls back to z.any()

- **WHEN** a tool parameter has a JSON Schema type that is not `string`, `number`, `boolean`, `array`, or `object`
- **THEN** the parameter is translated to `z.any()` (producing an empty schema entry), rather than throwing an error
