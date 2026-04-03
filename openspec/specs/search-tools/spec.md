## Purpose
Search tools allow AI agents to find content and files within a task's git worktree without having to enumerate directories manually.

## Requirements

### Requirement: search_text finds lines matching a pattern across worktree files
The system SHALL provide a `search_text` tool that performs a grep-like text or regex search across files in the worktree. The tool SHALL accept an optional glob pattern to restrict which files are searched, and SHALL return matching lines with their file paths and line numbers. Output SHALL be truncated if it exceeds the tool result size limit.

#### Scenario: Finds matching lines
- **WHEN** an agent calls `search_text` with a pattern that matches content in one or more files
- **THEN** the tool returns matching lines formatted as `file:line: content`

#### Scenario: No matches returns empty result indicator
- **WHEN** an agent calls `search_text` with a pattern that matches no files
- **THEN** the tool returns a message indicating no matches were found

#### Scenario: Search scoped by glob
- **WHEN** an agent calls `search_text` with a `glob` parameter (e.g. `src/**/*.ts`)
- **THEN** only files matching that glob are searched

#### Scenario: Regex pattern is supported
- **WHEN** an agent calls `search_text` with a regex pattern
- **THEN** the tool applies the pattern as a regular expression when searching

### Requirement: find_files discovers files by name or glob pattern
The system SHALL provide a `find_files` tool that lists files in the worktree matching a given glob pattern. Results SHALL be relative paths from the worktree root.

#### Scenario: Finds files matching pattern
- **WHEN** an agent calls `find_files` with a glob (e.g. `**/*.test.ts`)
- **THEN** the tool returns a list of relative file paths matching the glob

#### Scenario: No matches returns empty result indicator
- **WHEN** an agent calls `find_files` with a pattern that matches no files
- **THEN** the tool returns a message indicating no matching files were found

### Requirement: search_text supports returning context lines around matches
The system SHALL accept an optional `context_lines` integer parameter on `search_text`. When provided, the tool SHALL include that many lines before and after each match in the output (equivalent to `grep -C N`). The default SHALL be 0 (matching lines only, current behaviour).

#### Scenario: Context lines returned around match
- **WHEN** an agent calls `search_text` with `context_lines: 3`
- **THEN** up to 3 lines before and after each matching line are included in the output

#### Scenario: Default behaviour unchanged when context_lines omitted
- **WHEN** an agent calls `search_text` without a `context_lines` parameter
- **THEN** only matching lines are returned (no surrounding context)

### Requirement: fetch_url retrieves web page content as plain text
The system SHALL provide a `fetch_url` tool that fetches the content of a given URL and returns it as plain text with HTML tags stripped. The tool SHALL always be available (requires no API key). The tool SHALL reject URLs that resolve to private/loopback IP ranges (SSRF protection). Response size SHALL be capped at 100KB.

#### Scenario: Public URL fetched and returned as text
- **WHEN** an agent calls `fetch_url` with a valid public URL
- **THEN** the response body is returned with HTML tags removed and whitespace normalized

#### Scenario: Private IP URL rejected
- **WHEN** an agent calls `fetch_url` with a URL that resolves to a loopback or private IP (127.x, 10.x, 172.16–31.x, 192.168.x)
- **THEN** the tool returns an error and no request is made

#### Scenario: Response size capped
- **WHEN** the fetched page exceeds 100KB
- **THEN** the response is truncated to 100KB before being returned

### Requirement: search_internet queries a configured search engine
The system SHALL provide a `search_internet` tool that submits a query to a web search API and returns a ranked list of results (title, URL, and snippet per result). The tool SHALL be gated by the `search` block in `workspace.yaml` — if the block is absent, the engine is `"none"`, or the API key is empty, the tool SHALL return a clear configuration error rather than crashing.

#### Scenario: Successful search returns results
- **WHEN** `workspace.yaml` has a valid `search.engine` and `search.api_key`, and an agent calls `search_internet` with a query
- **THEN** up to 5 results are returned, each showing title, URL, and a short snippet

#### Scenario: Unconfigured search returns helpful error
- **WHEN** `workspace.yaml` has no `search` block or an empty `api_key`
- **THEN** the tool returns a message instructing the user to configure `search.engine` and `search.api_key`

#### Scenario: API error is surfaced as tool error string
- **WHEN** the search API returns an error response
- **THEN** the tool returns a descriptive error string and execution continues
