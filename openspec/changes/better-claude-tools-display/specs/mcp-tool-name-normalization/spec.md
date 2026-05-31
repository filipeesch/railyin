## Purpose
Defines the rules for normalizing MCP-prefixed tool names into human-readable display labels.

## ADDED Requirements

### Requirement: humanizeToolName converts raw tool names to readable labels
The system SHALL export a `humanizeToolName(name: string): string` function from `src/bun/engine/tool-display.ts` that transforms a raw tool name into a readable label by:
1. Stripping a leading `mcp__` prefix if present
2. Replacing all `__` (double-underscore) occurrences with a single space
3. Replacing all remaining `_` (single-underscore) occurrences with a single space

#### Scenario: Plain snake_case name is humanized
- **WHEN** `humanizeToolName("some_custom_tool")` is called
- **THEN** the return value is `"some custom tool"`

#### Scenario: External MCP tool name is humanized
- **WHEN** `humanizeToolName("mcp__other-server__do_thing")` is called
- **THEN** the return value is `"other-server do thing"`

#### Scenario: Name without underscores is unchanged
- **WHEN** `humanizeToolName("bash")` is called
- **THEN** the return value is `"bash"`

### Requirement: stripRailyinMcpPrefix removes the railyin MCP namespace
The system SHALL export a `stripRailyinMcpPrefix(name: string): string` function from `src/bun/engine/tool-display.ts` that removes the `mcp__railyin__` prefix when present and returns the name unchanged otherwise.

#### Scenario: Railyin-prefixed name is stripped
- **WHEN** `stripRailyinMcpPrefix("mcp__railyin__decision_request")` is called
- **THEN** the return value is `"decision_request"`

#### Scenario: Non-railyin MCP name is not stripped
- **WHEN** `stripRailyinMcpPrefix("mcp__other-server__do_thing")` is called
- **THEN** the return value is `"mcp__other-server__do_thing"` (unchanged)

#### Scenario: Plain name is not modified
- **WHEN** `stripRailyinMcpPrefix("bash")` is called
- **THEN** the return value is `"bash"` (unchanged)
