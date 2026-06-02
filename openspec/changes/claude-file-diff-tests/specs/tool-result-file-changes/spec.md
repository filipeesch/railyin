## ADDED Requirements

### Requirement: translateClaudeMessage emits accurate writtenFiles with StubFileStateCache
`translateClaudeMessage` with an injected `StubFileStateCache` SHALL be covered by pure in-memory unit tests in `claude-events.test.ts`. Tests SHALL cover: `write` with existing-file before-content produces correct `added`/`removed` counts, `write` with `null` before-content sets `is_new: true`, `write` with `undefined` before-content (not captured) falls back to shallow `{added:0, removed:0}`, `edit` produces a correct diff, `multiedit` produces a correct diff, and `delete` is called on the cache after `tool_result` is processed.

#### Scenario: write with existing before-content produces hunk diff
- **WHEN** the stub presets a string before-content for a `write` callId and a `tool_result` is translated
- **THEN** the resulting `tool_result` event has `writtenFiles[0]` with non-zero `added`/`removed` matching the actual diff

#### Scenario: write with null before-content sets is_new
- **WHEN** the stub presets `null` for a `write` callId (new file)
- **THEN** the resulting `writtenFiles[0]` has `is_new: true` and `removed === 0`

#### Scenario: write with undefined before-content falls back to shallow payload
- **WHEN** no preset is given for a callId (undefined)
- **THEN** the resulting `writtenFiles[0]` has `added === 0` and `removed === 0` with no hunks

#### Scenario: edit path produces hunk diff
- **WHEN** the stub presets before-content for an `edit` callId
- **THEN** the resulting `writtenFiles[0]` reflects the edit-applied diff

#### Scenario: multiedit path produces hunk diff
- **WHEN** the stub presets before-content for a `multiedit` callId
- **THEN** the resulting `writtenFiles[0]` reflects the combined multiedit diff

#### Scenario: cache delete called after tool_result
- **WHEN** a `tool_result` for a write-type tool is translated
- **THEN** `stub.trace.deleted` contains the callId, confirming the entry was released

### Requirement: FS integration test validates capture-to-diff path with real files
`claude-file-diff-integration.test.ts` SHALL test the full path: `DefaultFileStateCache.capture` reads before-content, a `writeFileSync` simulates tool execution, and `translateClaudeMessage` computes the correct diff. Tests SHALL cover: overwrite of existing file, new file creation, and two sequential writes to the same file within one execution.

#### Scenario: Overwrite produces accurate diff
- **WHEN** a file is captured before overwrite and `translateClaudeMessage` processes the result
- **THEN** `writtenFiles[0].added` and `.removed` reflect only the changed lines

#### Scenario: New file creation produces is_new diff
- **WHEN** a non-existent file path is captured and then created by the simulated tool write
- **THEN** `writtenFiles[0].is_new` is `true` and all file lines appear as added

#### Scenario: Sequential writes to the same file are independently accurate
- **WHEN** two sequential write tool calls target the same file in one execution
- **THEN** the first result diffs against the original file and the second result diffs only against the state left by the first write
