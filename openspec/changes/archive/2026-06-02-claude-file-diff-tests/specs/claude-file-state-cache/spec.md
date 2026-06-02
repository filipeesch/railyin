## ADDED Requirements

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
