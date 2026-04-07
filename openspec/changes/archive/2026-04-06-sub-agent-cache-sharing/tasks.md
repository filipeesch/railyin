## 1. System Message for Sub-agents

- [x] 1.1 In `runSubExecution`, prepend a system message `{ role: "system", content: "You are a focused sub-agent. Complete the task described below." }` before the user instructions message in `liveMessages`
- [x] 1.2 Sort `toolDefs` array returned by `resolveToolsForColumn` by `name` (ascending) before first use

## 2. Tests

- [x] 2.1 Write a unit test verifying `runSubExecution` places a system message at index 0 and user instructions at index 1
- [x] 2.2 Write a unit test verifying tool definitions are sorted by name
- [x] 2.3 Write a test verifying that two sub-agents with the same tools produce byte-identical system+tool prefixes
