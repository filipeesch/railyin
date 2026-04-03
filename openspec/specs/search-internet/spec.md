## Purpose
`search_internet` lets AI agents search the web via a configured search engine API, returning ranked results without requiring the agent to manually navigate search result pages.

## Requirements

### Requirement: search_internet queries the configured search engine API
The system SHALL provide a `search_internet` tool that submits the agent's query to a search engine API and returns up to 5 results, each containing a title, URL, and snippet. The v1 implementation SHALL support Tavily as the sole engine. The tool SHALL read the `search.engine` and `search.api_key` values from the loaded workspace config at call time.

#### Scenario: Query returns ranked results
- **WHEN** workspace config has `search.engine: tavily` and a valid `search.api_key`, and an agent submits a query
- **THEN** up to 5 results are returned in `title | url\nsnippet` format

#### Scenario: API error returned as tool error string
- **WHEN** the Tavily API returns a non-2xx response
- **THEN** the tool returns a descriptive error string and execution continues normally

### Requirement: search_internet degrades gracefully when not configured
The system SHALL return a user-readable configuration error — not throw an exception — when `search` config is absent or `api_key` is empty.

#### Scenario: No search config in workspace.yaml
- **WHEN** `workspace.yaml` has no `search` block
- **THEN** the tool returns "Error: search not configured — add search.engine and search.api_key to workspace.yaml"

#### Scenario: Empty api_key
- **WHEN** `workspace.yaml` has a `search` block but `api_key` is empty
- **THEN** the tool returns the same configuration error message
