## ADDED Requirements

### Requirement: HarnessContext loopDetector initialization is tested
`src/bun/test/pi-harness.test.ts` SHALL contain the following additional test cases:

- **HLC-1** `getOrCreateHarnessContext()` returns a context with a non-null `loopDetector` instance on first call
- **HLC-2** Second call for the same `conversationId` returns the same `loopDetector` instance (not a new one)
- **HLC-3** Fresh `loopDetector` has clean state — calling `record()` once returns `false`
