## 1. Task drawer Playwright coverage

- [x] 1.1 Create `e2e/ui/task-drawer.spec.ts`
- [x] 1.2 Cover drawer open, Chat/Info tabs, send, streaming, cancel, resize, and close flows
- [x] 1.3 Cover shared toolbar behavior such as models and attachments

## 2. Shared conversation body Playwright coverage

- [x] 2.1 Create `e2e/ui/conversation-body.spec.ts`
- [x] 2.2 Cover tool grouping, reasoning, streaming, and virtualization behavior

## 3. Session UI coverage expansion

- [x] 3.1 Extend session drawer coverage for send/receive and turn-state changes
- [x] 3.2 Add rename, archive, and cancel-in-flight regression scenarios where still missing

## 4. API integration coverage

- [x] 4.1 Extend `e2e/api/smoke.test.ts` with chat session lifecycle coverage
- [x] 4.2 Add standalone session chat interaction coverage using the fake provider/engine
- [x] 4.3 Add conversationId-based conversation-read coverage for task and session paths

## 5. Validation

- [x] 5.1 Keep the new coverage deterministic using existing fake-provider queues and test helpers
- [x] 5.2 Verify the new suites protect the shared chat rewrite boundaries
