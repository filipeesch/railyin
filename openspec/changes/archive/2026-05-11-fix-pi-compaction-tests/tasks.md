## 0. Refactoring — Enable Test Seam

- [x] 0.1 In `src/bun/engine/pi/engine.ts`, change `private async getOrCreateSession(...)` to `protected async getOrCreateSession(...)` — no other changes to the method body

## 1. Stream Processor Tests

- [x] 1.1 In `src/bun/test/stream-processor.test.ts`, add `describe("compaction_done content")` block with test SP-COMPACT-1: engine emits `{ type: "compaction_done", summary: "Summarised 40 messages." }` → DB row has `content = "Summarised 40 messages."`
- [x] 1.2 Add SP-COMPACT-2: engine emits `{ type: "compaction_done" }` (no summary) → DB row has `content = ""`
- [x] 1.3 Add SP-COMPACT-3: engine emits `compaction_start` then `compaction_done { summary: "S" }` → two rows exist in order (`system` + `compaction_summary` with `content = "S"`)

## 2. Pi Engine Unit Tests

- [x] 2.1 Create `src/bun/test/pi-engine.test.ts` with a `MockAgentSession` class implementing `compact()`, `isCompacting`, and `getContextUsage()` inline
- [x] 2.2 Add a `TestPiEngine extends PiEngine` class that overrides `protected getOrCreateSession()` to return the injected `MockAgentSession`
- [x] 2.3 Add PE-COMPACT-1: empty sessions map → `getOrCreateSession` called → `session.compact()` invoked
- [x] 2.4 Add PE-COMPACT-2: mock session has `isCompacting = true` → throws `"Compaction already in progress"`
- [x] 2.5 Add PE-COMPACT-3: `session.compact()` returns `{ summary: "the summary" }` → `compaction_summary` row in DB with matching content
- [x] 2.6 Add PE-COMPACT-4: `session.compact()` returns `null` → no `compaction_summary` row inserted

## 3. Orchestrator Tests

- [x] 3.1 In `src/bun/test/orchestrator.test.ts`, define `CompactableScriptedEngine extends ScriptedEngine` with a configurable `compact()` stub
- [x] 3.2 Add ORCH-COMPACT-1: `compact()` resolves and inserts a `compaction_summary` row → `onNewMessage` called with `type = "compaction_summary"`
- [x] 3.3 Add ORCH-COMPACT-2: engine has no `compact` method → `compactTask()` throws with compaction-unsupported message
- [x] 3.4 Add ORCH-COMPACT-3: `compact()` throws `"Compaction already in progress"` → error propagates from `compactTask()`

## 4. Frontend Store Tests

- [x] 4.1 In `src/mainview/stores/conversation.test.ts`, add SB-NEW-1: `onNewMessage({ conversationId: 42, type: "compaction_summary" })` when active conversation is 42 → `conversations.contextUsage` API called and `contextUsage` updated
- [x] 4.2 Add SB-NEW-2: same call but for non-active `conversationId: 99` → `conversations.contextUsage` NOT called

## 5. Playwright E2E Tests

- [x] 5.1 In `e2e/ui/extended-chat.spec.ts` Suite R, add R-24: sequential `contextUsage` mock (90% → 20%), compact button push triggers `message.new`, gauge updates from 90% to 20%
- [x] 5.2 Add R-25: `tasks.compact` mock returns error → error notification visible in UI within 3 seconds

## 6. Verification

- [x] 6.1 Run `bun test src/bun/test --timeout 20000` — all new tests pass, no regressions
- [x] 6.2 Run `bun test src/mainview/stores/conversation.test.ts` — SB-NEW-1 and SB-NEW-2 pass
- [x] 6.3 Run `bun run build && npx playwright test e2e/ui/extended-chat.spec.ts` — R-24 and R-25 pass
