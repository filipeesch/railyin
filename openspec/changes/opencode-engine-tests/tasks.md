## 1. Mock Adapter

- [ ] 1.1 Create `src/bun/test/support/opencode-sdk-mock.ts` with `MockOpenCodeSdkAdapter` implementing `OpenCodeSdkAdapter`
- [ ] 1.2 Add `trace` object: `createCalls`, `resumeCalls`, `listModelsCalls`, `listCommandsCalls`
- [ ] 1.3 Add `activeContexts: Set<number>` to track live execution contexts
- [ ] 1.4 Add `queueCreate(script)` and `queueResume(script)` methods for scripted turn sequences
- [ ] 1.5 Add `setModels(models)` and `setSkills(skills)` helpers
- [ ] 1.6 Add event builder helpers: `token`, `reasoning`, `toolStart`, `toolResult`, `done`, `usage`, `shellApproval`, `askUser`, `waitForAbort`, `fatal`

## 2. Unit Tests — Event Translator

- [ ] 2.1 Create `src/bun/test/opencode-events.test.ts`
- [ ] 2.2 Test `TextPart` → `{ type: "token", content }`
- [ ] 2.3 Test `ReasoningPart` → `{ type: "reasoning", content }`
- [ ] 2.4 Test `ToolPart` state=`running` → `{ type: "tool_start", name, arguments }`
- [ ] 2.5 Test `ToolPart` state=`completed` → `{ type: "tool_result", name, result }`
- [ ] 2.6 Test `ToolPart` state=`error` → `{ type: "tool_result", isError: true }`
- [ ] 2.7 Test `EventPermissionUpdated` → `{ type: "shell_approval" }`
- [ ] 2.8 Test `EventSessionIdle` → `{ type: "done" }`
- [ ] 2.9 Test `EventSessionStatus { type: "retry" }` → `{ type: "status" }`
- [ ] 2.10 Test `EventMessageUpdated` with tokens → `{ type: "usage" }`
- [ ] 2.11 Test unknown event type → no throw, no output

## 3. Unit Tests — Attachment Mapper

- [ ] 3.1 Create `src/bun/test/opencode-attachment-mapper.test.ts`
- [ ] 3.2 Test file attachment → `FilePartInput` with correct path
- [ ] 3.3 Test empty array → `[]`
- [ ] 3.4 Test `undefined` → `[]`

## 4. Unit Tests — Config Validation

- [ ] 4.1 Create `src/bun/test/opencode-config.test.ts` using `loadConfig` / `resetConfig` pattern
- [ ] 4.2 Test valid `engine.type: opencode` with provider → loads successfully
- [ ] 4.3 Test valid `engine.type: opencode` with no providers → loads successfully
- [ ] 4.4 Test local LLM provider with `npm` and `base_url` → loads successfully

## 5. Integration Tests — RPC Scenarios

- [ ] 5.1 Create `src/bun/test/opencode-rpc-scenarios.test.ts`
- [ ] 5.2 Implement `createOpenCodeRuntime(adapter)` using `createBackendRpcRuntime`
- [ ] 5.3 Run `runSingleTurnChatScenario` and `runMultiTurnChatScenario`
- [ ] 5.4 Run `runToolSuccessScenario` and `runToolFailureScenario`
- [ ] 5.5 Run `runAskUserScenario` and `runAskUserResumeScenario`
- [ ] 5.6 Run `runCancellationScenario` and `runFatalFailureScenario`
- [ ] 5.7 Run `runModelListingScenario`

## 6. Integration Tests — Session Lifecycle

- [ ] 6.1 Add test: first `execute()` with new `conversationId` → `trace.createCalls.length === 1`
- [ ] 6.2 Add test: second `execute()` same `conversationId` → `trace.resumeCalls.length === 1`, `trace.createCalls` unchanged
- [ ] 6.3 Add test: two distinct `conversationId` values → `trace.createCalls.length === 2`
- [ ] 6.4 Add test: after successful execution → `activeContexts` does not contain `conversationId`
- [ ] 6.5 Add test: after fatal error execution → `activeContexts` does not contain `conversationId`

## 7. Extend Existing Tests

- [ ] 7.1 Add test in `src/bun/test/lease-registry.test.ts`: construct `LeaseRegistry("opencode", ...)` and verify touch/expire lifecycle works correctly
