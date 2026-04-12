## MODIFIED Requirements

### Requirement: search_text uses ripgrep backend with output modes

The `search_text` tool SHALL use ripgrep (`rg`) as its search backend when available, falling back to the current implementation if `rg` is not found. The tool SHALL accept an `output_mode` parameter with values `"content"` (default, returns matching lines with context), `"files_with_matches"` (returns only filenames), or `"count"` (returns occurrence counts per file). The tool SHALL accept `limit` (default 250) and `offset` (default 0) parameters for pagination. Output SHALL be capped at 20,000 chars.

#### Scenario: Content mode returns matching lines (default)
- **WHEN** `search_text` is called with `pattern: "TODO"` and no `output_mode`
- **THEN** results show matching lines with file paths and line numbers, capped at 20,000 chars

#### Scenario: files_with_matches mode returns filenames only
- **WHEN** `search_text` is called with `output_mode: "files_with_matches"`
- **THEN** results show only filenames sorted by modification time (newest first)

#### Scenario: count mode returns occurrences per file
- **WHEN** `search_text` is called with `output_mode: "count"`
- **THEN** results show `"file.ts:5\nother.ts:3\n\nFound 8 total occurrences across 2 files."`

#### Scenario: Pagination with limit and offset
- **WHEN** `search_text` is called with `limit: 10, offset: 20`
- **THEN** the first 20 results are skipped and the next 10 are returned, with a pagination indicator

#### Scenario: Ripgrep not available falls back gracefully
- **WHEN** `rg` is not found on the system PATH
- **THEN** the tool uses the current implementation and logs a one-time warning

### Requirement: find_files sorts by modification time with truncation flag

The `find_files` tool SHALL sort results by file modification time (newest first). When results exceed the limit (500 files), the output SHALL include a truncation indicator: `"(Results truncated. Consider a more specific pattern.)"`.

#### Scenario: Results sorted by mtime
- **WHEN** `find_files` is called and matches 50 files
- **THEN** files are returned sorted with most recently modified first

#### Scenario: Truncation indicator shown
- **WHEN** `find_files` matches more than 500 files
- **THEN** the output ends with the truncation indicator message
