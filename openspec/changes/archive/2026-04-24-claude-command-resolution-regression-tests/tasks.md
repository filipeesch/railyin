## 1. Unit tests — chat-chips

- [x] 1.1 Add unit test for colon-separated slash chip round-trip in `src/bun/test/chat-chips.test.ts`

## 2. API integration tests — tasks.sendMessage

- [x] 2.1 Add `tasks.sendMessage` slash chip test (engineContent fast path) in `e2e/api/smoke.test.ts`
- [x] 2.2 Add `tasks.sendMessage` slash chip test (extractChips fallback, no engineContent) in `e2e/api/smoke.test.ts`

## 3. API integration tests — chatSessions.sendMessage

- [x] 3.1 Add `chatSessions.sendMessage` slash chip test (engineContent fast path) in `e2e/api/smoke.test.ts`
- [x] 3.2 Add `chatSessions.sendMessage` slash chip test (extractChips fallback, no engineContent) in `e2e/api/smoke.test.ts`

## 4. Verification

- [x] 4.1 Run `bun test src/bun/test/chat-chips.test.ts --timeout 20000` and confirm all tests pass
- [x] 4.2 Run `bun test e2e/api/smoke.test.ts --timeout 30000` and confirm all tests pass
