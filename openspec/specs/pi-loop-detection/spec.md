# Pi Loop Detection

## Purpose

Provides `ToolLoopDetector`, a sliding-window utility that tracks tool call fingerprints and detects when the same tool is called with the same arguments too many times within a recent window — signalling a stuck agent loop.

## Requirements

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

### Requirement: ToolLoopDetector unit tests cover all spec scenarios and edge cases
`src/bun/test/pi/tool-loop-detector.test.ts` SHALL contain at minimum the following test cases:

- **TLD-1** Same tool called 3× in a row — third `record()` returns `true`
- **TLD-2** Same tool called 2×, then different tool — none return `true`
- **TLD-3** Cyclic group ABCABC — 5th call (`record("A",...)` for the 3rd time) returns `true`
- **TLD-4** Window eviction — `read(a)` × 2, then 13 distinct calls (evicting both), then `read(a)` × 1 → returns `false`
- **TLD-5** `reset()` clears all state — post-reset first call for a previously-3× fingerprint returns `false`
- **TLD-6** Normalized key order — `{path, content}` and `{content, path}` treated as same fingerprint
- **TLD-7** Different args on same tool not conflated — `read({path:"a"})` × 2 + `read({path:"b"})` × 1 → none trigger
- **TLD-8** Threshold boundary — exactly 2 repeats → `false`; 3rd repeat → `true`
- **TLD-9** ABAB 2-tool cycle — A triggers on 5th call (A×3 within window)
- **TLD-10** ABCDE 5-tool full cycle — A triggers on 11th call (window=15 contains A×3 after 2 full cycles + 1 extra)
- **TLD-11** Empty args `{}` fingerprints correctly and does not throw
- **TLD-12** Nested args — deep nesting is NOT recursively sorted (shallow sort only); test documents this behavior explicitly
