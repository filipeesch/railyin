## 1. Mock SDK Implementation

- [ ] 1.1 Create `src/bun/test/cursor/mocks.ts` with MockCursorSession
  - [ ] 1.1.1 Implement AsyncGenerator stream for `Run.stream()`
  - [ ] 1.1.2 Implement `send()` method for message queuing
  - [ ] 1.1.3 Implement `abort()` and `disconnect()` methods
  - [ ] 1.1.4 Add `queueTurn()` and `queueNext()` helpers
- [ ] 1.2 Create `src/bun/test/cursor/adapter.test.ts` with adapter tests
  - [ ] 1.2.1 Test `createSession()` returns MockCursorSession
  - [ ] 1.2.2 Test `resumeSession()` returns MockCursorSession
  - [ ] 1.2.3 Test `listModels()` returns Cursor SDK model info
  - [ ] 1.2.4 Test `cancel()` aborts in-progress execution
  - [ ] 1.2.5 Test `listCommands()` returns available commands

## 2. Integration Tests

- [ ] 2.1 Create `src/bun/test/cursor/integration.test.ts` with shared scenarios
  - [ ] 2.1.1 Test single-turn chat scenario
  - [ ] 2.1.2 Test multi-turn chat scenario
  - [ ] 2.1.3 Test tool success scenario
  - [ ] 2.1.4 Test tool failure scenario
  - [ ] 2.1.5 Test ask_user suspension scenario
  - [ ] 2.1.6 Test cancellation scenario
  - [ ] 2.1.7 Test fatal failure scenario
  - [ ] 2.1.8 Test model listing scenario

## 3. Playwright UI Tests

- [ ] 3.1 Create `e2e/ui/cursor.spec.ts`
  - [ ] 3.1.1 Test Cursor engine appears in model picker
  - [ ] 3.1.2 Test Cursor engine selection works
  - [ ] 3.1.3 Test token streaming works correctly
  - [ ] 3.1.4 Test tool execution renders correctly
  - [ ] 3.1.5 Test ask_user flow works
