## ADDED Requirements

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
