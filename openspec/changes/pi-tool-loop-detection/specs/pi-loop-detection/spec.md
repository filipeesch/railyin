## ADDED Requirements

### Requirement: ToolLoopDetector tracks tool call fingerprints in a sliding window
`ToolLoopDetector` SHALL maintain a ring buffer of the last 15 tool call fingerprints. Each fingerprint SHALL be computed as `"${toolName}:${JSON.stringify(args, sortedKeys)}"` where `sortedKeys` is a shallow alphabetical sort of the args object's own enumerable keys. `record(toolName, args)` SHALL return `true` when the just-added fingerprint has appeared ≥ 3 times within the current window, and `false` otherwise. `reset()` SHALL clear the ring buffer and all counts.

#### Scenario: Same tool called 3 times in a row is detected
- **WHEN** `record("read", { path: "file.ts" })` is called 3 times consecutively
- **THEN** the third call returns `true`

#### Scenario: Same tool called only twice is not detected
- **WHEN** `record("read", { path: "file.ts" })` is called twice, followed by `record("grep", { pattern: "foo" })`
- **THEN** none of the three calls return `true`

#### Scenario: Cyclic group loop detected within window
- **WHEN** the following sequence is recorded: `read(a)`, `grep(b)`, `read(a)`, `grep(b)`, `read(a)`
- **THEN** the fifth call (`read(a)` appearing for the 3rd time) returns `true`

#### Scenario: Window eviction prevents stale counts from triggering detection
- **WHEN** `read(a)` is called twice, then 13 other distinct calls are recorded (evicting the first two `read(a)` entries), then `read(a)` is called once more
- **THEN** the final `read(a)` call returns `false` (only 1 occurrence in current window)

#### Scenario: reset() clears all state
- **WHEN** `record("read", { path: "file.ts" })` is called 3 times and `reset()` is called afterwards
- **THEN** calling `record("read", { path: "file.ts" })` once returns `false`

#### Scenario: Normalized key order prevents false negatives
- **WHEN** `record("write", { content: "x", path: "f.ts" })` is called once and `record("write", { path: "f.ts", content: "x" })` is called twice more
- **THEN** the third call returns `true` (same fingerprint despite different key order)

#### Scenario: Different args on same tool are not conflated
- **WHEN** `record("read", { path: "a.ts" })` is called twice and `record("read", { path: "b.ts" })` is called once
- **THEN** none of the calls return `true`
