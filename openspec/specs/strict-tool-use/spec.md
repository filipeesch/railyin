## ADDED Requirements

### Requirement: All Anthropic tool definitions use strict mode
The system SHALL set `strict: true` on every tool definition sent to the Anthropic API, enabling grammar-constrained sampling so that tool call inputs always match the declared JSON Schema.

#### Scenario: adaptTools sets strict on each tool
- **WHEN** `adaptTools()` converts an `AIToolDefinition[]` to Anthropic wire format
- **THEN** every resulting object has `strict: true` as a top-level property alongside `name`, `description`, and `input_schema`

#### Scenario: adaptTools adds additionalProperties false to every schema
- **WHEN** `adaptTools()` converts an `AIToolDefinition[]` to Anthropic wire format
- **THEN** every resulting `input_schema` object has `additionalProperties: false`

#### Scenario: Strict mode applies to sub-agent tool calls
- **WHEN** `runSubExecution` resolves tools for a child agent and calls `retryTurn`
- **THEN** the tools passed to the provider are also sent with `strict: true` (via `adaptTools`)

#### Scenario: Strict mode applies to parent agent tool calls
- **WHEN** the parent execution calls `retryStream` with a resolved tool list
- **THEN** all tools are sent with `strict: true` (via `adaptTools`)
