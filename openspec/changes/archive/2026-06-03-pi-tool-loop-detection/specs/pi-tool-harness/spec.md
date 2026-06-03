## ADDED Requirements

### Requirement: HarnessContext exposes a ToolLoopDetector
`HarnessContext` SHALL include a `loopDetector: ToolLoopDetector` field. This field SHALL be initialized when `getOrCreateHarnessContext()` creates a new context entry.
