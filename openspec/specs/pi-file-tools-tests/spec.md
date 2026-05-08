# Pi File Tools Tests

## Purpose

Integration test coverage for Pi harness file, search, and shell tools. Tests use a real filesystem with `mkdtemp` tmpdir per test group.

## Requirements

### Requirement: Pi file tool integration test coverage
The test suite SHALL cover all Pi harness file tools via real filesystem in `src/bun/test/pi-file-tools.test.ts`. Each test group uses a fresh `tmpdir` created with `mkdtemp` and removed in `afterEach`.

#### Scenario: FT-1 read_file returns numbered content with metadata header
- **WHEN** `read_file({ path: "foo.ts" })` is called on an existing file
- **THEN** result starts with `[file: foo.ts, lines: N, showing: 1-N]`
- **AND** content lines are prefixed with 1-based line numbers

#### Scenario: FT-2 read_file with range returns only requested lines
- **WHEN** `read_file({ path, start_line: 5, end_line: 10 })` is called
- **THEN** header shows `showing: 5-10` and only those lines are returned

#### Scenario: FT-3 read_file over 500KB returns error
- **WHEN** `read_file` is called on a file larger than 500KB
- **THEN** returns `"Error: file too large"` message

#### Scenario: FT-4 read_file caches on first read, returns [unchanged] on repeat
- **WHEN** `read_file` is called twice for the same file without modification
- **THEN** second call returns `"[file unchanged since turn N — use your cached version]"`

#### Scenario: FT-5 write_file creates file and returns op:XXXX
- **WHEN** `write_file({ path: "new.ts", content: "hello" })` is called
- **THEN** file is created on disk with that content
- **AND** result string contains `op:` followed by 4 hex chars

#### Scenario: FT-6 patch_file replaces string and returns op:XXXX
- **WHEN** `patch_file({ path, old_string: "foo", new_string: "bar" })` is called
- **THEN** file content has "foo" replaced with "bar"
- **AND** result contains an operationId

#### Scenario: FT-7 undo_write by path restores previous content
- **WHEN** `write_file` then `undo_write({ path })` is called
- **THEN** file is restored to its pre-write content
- **AND** result confirms restoration

#### Scenario: FT-8 chained undo_write peels layers
- **WHEN** three successive writes to the same path are followed by three `undo_write({ path })` calls
- **THEN** file content walks back v3 → v2 → original in sequence

#### Scenario: FT-9 delete_file removes file and undo restores it
- **WHEN** `delete_file({ path })` then `undo_write({ path })` is called
- **THEN** file is restored with original content

#### Scenario: FT-10 rename_file moves file and undo restores it
- **WHEN** `rename_file({ from: "a.ts", to: "b.ts" })` then `undo_write({ path: "a.ts" })` is called
- **THEN** `a.ts` is restored and `b.ts` is removed

#### Scenario: FT-11 glob returns files sorted by mtime
- **WHEN** `glob({ pattern: "**/*.ts" })` is called
- **THEN** returns relative paths sorted by mtime descending, limited to 100 entries

#### Scenario: FT-12 glob with type=dir returns only directories
- **WHEN** `glob({ pattern: "src/*", type: "dir" })` is called
- **THEN** returns only directory names, no files

#### Scenario: FT-13 glob with limit and offset paginates
- **WHEN** `glob({ pattern: "**/*.ts", limit: 2, offset: 2 })` is called on a dir with 5 ts files
- **THEN** returns entries 3 and 4, with pagination footer

### Requirement: Pi search tool integration test coverage
The test suite SHALL cover `search_text` in `src/bun/test/pi-search-tools.test.ts` with a real tmpdir.

#### Scenario: ST-1 search_text returns matching lines with context_lines
- **WHEN** `search_text({ pattern: "TODO", context_lines: 1 })` is called
- **THEN** returns matching lines with one surrounding line each, separated by `--`

#### Scenario: ST-2 search_text output_mode=files_with_matches returns paths only
- **WHEN** `search_text({ pattern: "TODO", output_mode: "files_with_matches" })` is called
- **THEN** returns only file paths, no content lines

#### Scenario: ST-3 search_text result is cached and returns [unchanged] on repeat
- **WHEN** same `search_text` params are called twice without file changes
- **THEN** second call returns `"[search unchanged — N matches, same as turn M]"`

#### Scenario: ST-4 write_file to matching path invalidates search cache
- **WHEN** `search_text` is called, then `write_file` to a file matching the glob, then `search_text` again
- **THEN** third call returns fresh results, not `[unchanged]`

#### Scenario: ST-5 search_text fallback walker works when rg is unavailable
- **WHEN** the `rg` binary is not on PATH and `search_text` is called
- **THEN** results are still returned using the hand-rolled fallback walker

### Requirement: Pi shell tool integration test coverage
The test suite SHALL cover `run_command` in `src/bun/test/pi-shell-tool.test.ts`.

#### Scenario: SH-1 run_command executes in worktreePath
- **WHEN** `run_command({ command: "pwd" })` is called
- **THEN** output matches the tmpdir worktreePath

#### Scenario: SH-2 run_command output is truncated at 8KB
- **WHEN** command produces more than 8KB of stdout
- **THEN** result is truncated to 8KB and appended with `"\n[truncated]"`

#### Scenario: SH-3 run_command pipe works
- **WHEN** `run_command({ command: "echo hello | tr a-z A-Z" })` is called
- **THEN** returns `"HELLO"`

#### Scenario: SH-4 run_command timeout returns error after 15 seconds
- **WHEN** `run_command({ command: "sleep 30" })` is called
- **THEN** execution is terminated after 15 seconds and result contains a timeout error
