## 1. Mock Adapter

- [x] 1.1 Create `src/bun/test/support/opencode-sdk-mock.ts` with `MockOpenCodeSdkAdapter` implementing `OpenCodeSdkAdapter`
- [x] 1.2 Add `trace` object: `createCalls`, `resumeCalls`, `listModelsCalls`, `listCommandsCalls`
- [x] 1.3 Add `activeContexts: Set<number>` to track live execution contexts
- [x] 1.4 Add `queueCreate(script)` and `queueResume(script)` methods for scripted turn sequences
- [x] 1.5 Add `setModels(models)` and `setSkills(skills)` helpers
- [x] 1.6 Add event builder helpers: `token`, `reasoning`, `toolStart`, `toolResult`, `done`, `usage`, `shellApproval`, `askUser`, `waitForAbort`, `fatal`

## 2. Unit Tests — Event Translator

- [x] 2.1 Create `src/bun/test/opencode-events.test.ts`
- [x] 2.2 Test `TextPart` → `{ type: "token", content }`
- [x] 2.3 Test `ReasoningPart` → `{ type: "reasoning", content }`
- [x] 2.4 Test `ToolPart` state=`running` → `{ type: "tool_start", name, arguments }`
- [x] 2.5 Test `ToolPart` state=`completed` → `{ type: "tool_result", name, result }`
- [x] 2.6 Test `ToolPart` state=`error` → `{ type: "tool_result", isError: true }`
- [x] 2.7 Test `EventPermissionUpdated` → `{ type: "shell_approval" }`
- [x] 2.8 Test `EventSessionIdle` → `{ type: "done" }`
- [x] 2.9 Test `EventSessionStatus { type: "retry" }` → `{ type: "status" }`
- [x] 2.10 Test `EventMessageUpdated` with tokens → `{ type: "usage" }`
- [x] 2.11 Test unknown event type → no throw, no output

## 3. Unit Tests — Attachment Mapper

- [x] 3.1 Create `src/bun/test/opencode-attachment-mapper.test.ts`
- [x] 3.2 Test file attachment → `FilePartInput` with correct path
- [x] 3.3 Test empty array → `[]`
- [x] 3.4 Test `undefined` → `[]`

## 4. Unit Tests — Config Validation

- [x] 4.1 Create `src/bun/test/opencode-config.test.ts` using `loadConfig` / `resetConfig` pattern
- [x] 4.2 Test valid `engine.type: opencode` with provider → loads successfully
- [x] 4.3 Test valid `engine.type: opencode` with no providers → loads successfully
- [x] 4.4 Test local LLM provider with `npm` and `base_url` → loads successfully

## 5. Integration Tests — RPC Scenarios

- [x] 5.1 Create `src/bun/test/opencode-rpc-scenarios.test.ts`
- [x] 5.2 Implement `createOpenCodeRuntime(adapter)` using `createBackendRpcRuntime`
- [x] 5.3 Run `runSingleTurnChatScenario` and `runMultiTurnChatScenario`
- [x] 5.4 Run `runToolSuccessScenario` and `runToolFailureScenario`
- [x] 5.5 Run `runAskUserScenario` and `runAskUserResumeScenario`
- [x] 5.6 Run `runCancellationScenario` and `runFatalFailureScenario`
- [x] 5.7 Run `runModelListingScenario`

## 6. Integration Tests — Session Lifecycle

- [x] 6.1 Add test: first `execute()` with new `conversationId` → `trace.createCalls.length === 1`
- [x] 6.2 Add test: second `execute()` same `conversationId` → `trace.resumeCalls.length === 1`, `trace.createCalls` unchanged
- [x] 6.3 Add test: two distinct `conversationId` values → `trace.createCalls.length === 2`
- [x] 6.4 Add test: after successful execution → `activeContexts` does not contain `conversationId`
- [x] 6.5 Add test: after fatal error execution → `activeContexts` does not contain `conversationId`

## 7. Extend Existing Tests

- [x] 7.1 Add test in `src/bun/test/lease-registry.test.ts`: construct `LeaseRegistry("opencode", ...)` and verify touch/expire lifecycle works correctly
