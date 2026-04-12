## MODIFIED Requirements

### Requirement: Sub-agents use parent's full tool definitions for cache prefix sharing

When running a sub-execution via `spawn_agent`, the system SHALL pass the **parent's full tool definitions** (sorted alphabetically) to the API call. The child's `tools` array from the spawn_agent arguments SHALL be used only as an execution-time whitelist. When the model calls a tool not in the whitelist, the executor SHALL return an error: `"Error: tool '{name}' is not available to this sub-agent."`.

#### Scenario: Sub-agent API call uses parent's tools
- **WHEN** a parent with 17 tools spawns a sub-agent with `tools: ["read_file"]`
- **THEN** the API call to Anthropic includes all 17 tool definitions (matching the parent's cache prefix)

#### Scenario: Sub-agent restricted from calling non-whitelisted tool
- **WHEN** a sub-agent with whitelist `["read_file"]` tries to call `write_file`
- **THEN** the tool result returns `"Error: tool 'write_file' is not available to this sub-agent."`

#### Scenario: Sub-agent can call whitelisted tools normally
- **WHEN** a sub-agent with whitelist `["read_file", "search_text"]` calls `read_file`
- **THEN** the tool executes normally and returns the file content

### Requirement: Sub-agent default max_tokens is 16384

The system SHALL use a default `max_tokens` of 16384 for sub-agent API calls (up from 8192). The existing escalation to 64000 on truncation SHALL remain as a fallback.

#### Scenario: Sub-agent uses higher default max_tokens
- **WHEN** a sub-agent is spawned without explicit max_tokens
- **THEN** the API call uses `max_tokens: 16384`

#### Scenario: Escalation still works on truncation
- **WHEN** a sub-agent response is truncated at 16384 tokens
- **THEN** the system retries with `max_tokens: 64000`
