# claude-file-state-cache Specification

## Purpose
TBD - created by archiving change claude-accurate-file-diffs. Update Purpose after archive.
## Requirements
### Requirement: FileStateCache captures file content before tool execution
The system SHALL provide a `FileStateCache` interface with `capture(callId, worktreePath, filePath)`, `get(callId)`, `delete(callId)`, and `clear()` methods. The default implementation SHALL read the file synchronously before the tool writes it. If the file does not exist, `capture` SHALL store `null` for that `callId`. If reading fails for any reason, `capture` SHALL store `null` (non-fatal degradation).

#### Scenario: Existing file captured before write
- **WHEN** `capture` is called with a valid path to an existing file
- **THEN** `get(callId)` returns the file's content as a string

#### Scenario: New file captured before write
- **WHEN** `capture` is called with a path to a file that does not yet exist
- **THEN** `get(callId)` returns `null`

#### Scenario: Cache entry is deleted after use
- **WHEN** `delete(callId)` is called
- **THEN** subsequent `get(callId)` returns `undefined`

#### Scenario: Cache is cleared at execution end
- **WHEN** `clear()` is called
- **THEN** all entries are removed from the cache

### Requirement: FileStateCache lifecycle is scoped to a single execution
A `FileStateCache` instance SHALL be created per execution in `ClaudeEngine`, passed through `ClaudeRunConfig` and `translateClaudeMessage` options, and cleared when the execution ends — mirroring the `toolMetaByCallId` lifecycle.

#### Scenario: Separate executions have isolated caches
- **WHEN** two concurrent executions each process a `write` tool call on the same file
- **THEN** each cache holds its own before-content independently without interference

### Requirement: DefaultFileStateCache is testable in isolation
The `DefaultFileStateCache` implementation SHALL be testable via `file-state-cache.test.ts` using a real temporary directory. Tests SHALL cover: capture of an existing file returns its content, capture of a non-existent file returns `null`, read failure returns `null` (non-fatal), `delete` removes the entry, `clear` removes all entries, and two different callIds hold independent values.

#### Scenario: Existing file captured
- **WHEN** a file exists at the given path and `capture(callId, dir, relPath)` is called
- **THEN** `get(callId)` returns the exact content string read from that file

#### Scenario: Non-existent file yields null
- **WHEN** no file exists at the given path and `capture(callId, dir, relPath)` is called
- **THEN** `get(callId)` returns `null`

#### Scenario: Read failure yields null (non-fatal)
- **WHEN** `capture` encounters a filesystem error (e.g. permission denied)
- **THEN** `get(callId)` returns `null` and no exception is propagated

#### Scenario: callId isolation
- **WHEN** two different callIds are captured with different file contents
- **THEN** each `get` returns only its own content without cross-contamination

#### Scenario: delete removes single entry
- **WHEN** `delete(callId)` is called after `capture`
- **THEN** `get(callId)` returns `undefined`

#### Scenario: clear removes all entries
- **WHEN** `clear()` is called after multiple captures
- **THEN** all subsequent `get` calls return `undefined`

