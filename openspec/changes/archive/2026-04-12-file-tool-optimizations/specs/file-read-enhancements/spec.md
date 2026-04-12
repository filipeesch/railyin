## ADDED Requirements

### Requirement: read_file output includes line numbers

The `read_file` tool SHALL prepend line numbers to each line of output using the format `{lineNum padded to 6 chars}→{line content}`. Line numbers SHALL be 1-based and correspond to the actual line positions in the file.

#### Scenario: Full file read includes line numbers
- **WHEN** `read_file` is called for a 3-line file without start_line/end_line
- **THEN** the output contains `     1→first line\n     2→second line\n     3→third line`

#### Scenario: Partial read line numbers reflect actual positions
- **WHEN** `read_file` is called with `start_line: 10, end_line: 12`
- **THEN** the output line numbers start at 10: `    10→line ten\n    11→line eleven\n    12→line twelve`

### Requirement: read_file output includes metadata header

The `read_file` tool SHALL prepend a metadata header line before the content: `[file: {relative_path}, lines: {totalLines}, showing: {startLine}-{endLine}]`. The header SHALL always show `totalLines` (the total number of lines in the file) regardless of the range requested.

#### Scenario: Full file read shows total lines
- **WHEN** `read_file` is called for a 342-line file without range parameters
- **THEN** the first line of output is `[file: src/foo.ts, lines: 342, showing: 1-342]`

#### Scenario: Partial read shows range and total
- **WHEN** `read_file` is called with `start_line: 50, end_line: 75` on a 342-line file
- **THEN** the first line of output is `[file: src/foo.ts, lines: 342, showing: 50-75]`

### Requirement: read_file deduplicates unchanged file re-reads

The system SHALL track `mtimeMs` for each file path read during an execution. When the same file path (and same range) is re-read and the file's `mtimeMs` has not changed, the tool SHALL return `"File unchanged since last read — refer to the earlier tool result."` instead of the file content.

#### Scenario: Re-read of unchanged file returns stub
- **WHEN** `read_file` is called for `src/foo.ts` a second time with identical mtime
- **THEN** the tool returns the unchanged stub message instead of file content

#### Scenario: Re-read after modification returns fresh content
- **WHEN** `read_file` is called for `src/foo.ts`, then the file is modified (mtime changes), then `read_file` is called again
- **THEN** the tool returns the full content with line numbers (not the stub)

### Requirement: read_file returns warnings for empty files and offset-past-EOF

The tool SHALL return explicit warning messages for edge cases instead of empty strings.

#### Scenario: Empty file returns warning
- **WHEN** `read_file` is called for a file that exists but has no content
- **THEN** the tool returns `"Warning: the file exists but the contents are empty."`

#### Scenario: start_line beyond file length returns warning
- **WHEN** `read_file` is called with `start_line: 500` on a file with 100 lines
- **THEN** the tool returns `"Warning: the file exists but is shorter than the provided start_line (500). The file has 100 lines."`
