## ADDED Requirements

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
