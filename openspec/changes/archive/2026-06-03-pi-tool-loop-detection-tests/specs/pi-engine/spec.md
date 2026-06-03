## ADDED Requirements

### Requirement: PiEngine loop guard wiring is covered by integration tests
`src/bun/test/pi/loop-detection-engine.test.ts` SHALL contain the following test cases (pattern: `MockBgSession` + `makePiEngine` + `runExecution`, same as `background-compaction.test.ts`):

- **LDE-1** `beforeToolCall` is wired after session creation — `session.agent.beforeToolCall` is not `undefined` after `execute()` begins
- **LDE-2** Detector resets between executions — execution 1 populates the detector (2 calls for same fingerprint); execution 2 makes 1 call for same fingerprint; no block fires in execution 2
- **LDE-3** Loop triggers block — `MockBgSession.prompt()` calls `beforeToolCall` 3× with the same fingerprint; verify the third call returns `{ block: true }` and includes a non-empty `reason` string
- **LDE-4** Same `conversationId` across two executions shares the same `loopDetector` instance (from `HarnessContext`) but has it reset
- **LDE-5** Different `conversationId`s get independent detectors — conv 101 loops (3 same-fingerprint calls), conv 102 makes the same calls independently; neither interferes with the other

### Requirement: buildDelegateTool child session loop guard is covered
`src/bun/test/pi/delegate.test.ts` SHALL contain the following additional test cases (DL-15–DL-18):

- **DL-15** `beforeToolCall` is wired — after `childSessionFactory` returns a `MockChildSession`, `session.agent.beforeToolCall` is set (not `undefined`) before `prompt()` is called
- **DL-16** Child loop triggers block — `MockChildSession` configured with a 3-call sequence for same fingerprint; verify the digest for that job contains the blocked-call error message
- **DL-17** Independent detectors per child job — job-A triggers its detector; job-B with same tool calls is clean; job-B's digest is normal
- **DL-18** No cross-job detector sharing — job-1 records 2 calls, job-2 records 2 calls for the same fingerprint; neither triggers (count is 2 in each isolated detector)
