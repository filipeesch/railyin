## ADDED Requirements

### Requirement: StubFileStateCache implements FileStateCache for test use
The test support module SHALL provide a `StubFileStateCache` class in `src/bun/test/support/stub-file-state-cache.ts` that implements the `FileStateCache` interface. It SHALL support pre-loading return values via a `preset(callId, content)` builder method, record calls to `delete()` in a `trace.deleted` array, and record calls to `clear()` in a `trace.cleared` counter. A `reset()` method SHALL clear both the store and the trace, allowing reuse between test cases.

#### Scenario: Preset content returned by get
- **WHEN** `preset("c1", "old content\n")` is called before `get("c1")`
- **THEN** `get("c1")` returns `"old content\n"`

#### Scenario: Preset null returned for new-file signal
- **WHEN** `preset("c1", null)` is called before `get("c1")`
- **THEN** `get("c1")` returns `null`

#### Scenario: Unpreseted callId returns undefined
- **WHEN** `get("unknown")` is called without prior `preset("unknown", ...)`
- **THEN** `get("unknown")` returns `undefined`

#### Scenario: delete records in trace and removes entry
- **WHEN** `delete("c1")` is called after `preset("c1", "content")`
- **THEN** `trace.deleted` contains `"c1"` and subsequent `get("c1")` returns `undefined`

#### Scenario: clear records in trace and removes all entries
- **WHEN** `clear()` is called after multiple `preset` calls
- **THEN** `trace.cleared` is incremented and all entries are removed

#### Scenario: reset restores clean state for reuse
- **WHEN** `reset()` is called after a test
- **THEN** `trace.deleted` is empty, `trace.cleared` is 0, and all presets are gone
