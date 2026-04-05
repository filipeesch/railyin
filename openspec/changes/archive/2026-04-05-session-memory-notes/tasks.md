## 1. Infrastructure: Session Memory File Service

- [x] 1.1 Create `src/bun/workflow/session-memory.ts` with: `getSessionMemoryPath(taskId)` (returns `~/.config/railyin/tasks/<id>/session-notes.md`), `readSessionMemory(taskId)` (returns content or null), `writeSessionMemory(taskId, content)` (atomic write via temp+rename)
- [x] 1.2 Add constants `SESSION_MEMORY_EXTRACTION_INTERVAL = 5` and `SESSION_MEMORY_MAX_CHARS = 8000` to the service file
- [x] 1.3 Create the extraction prompt in `session-memory.ts`: instructs the model to produce a structured markdown notes file with sections: Open Decisions, Key Files Changed, Technical Context, User Preferences Observed — full replacement on each extraction

## 2. Background Extraction Trigger

- [x] 2.1 In `runExecution()` in `engine.ts`, track the AI turn count per execution
- [x] 2.2 After each completed AI turn (when the model's response is received and stored), if `turnCount % SESSION_MEMORY_EXTRACTION_INTERVAL === 0`, fire a non-blocking background extraction call — use `Promise.resolve().then(() => extractSessionMemory(taskId))` or equivalent fire-and-forget pattern
- [x] 2.3 Implement `extractSessionMemory(taskId)` in `session-memory.ts`: reads last N messages, calls the AI with the extraction prompt, writes the result to the notes file atomically

## 3. System Prompt Injection

- [x] 3.1 In the system prompt assembly in `engine.ts` (where the stage instructions are composed), call `readSessionMemory(taskId)` and if non-null, append a `\n\n## Session Notes\n\n<content>` block, truncated to `SESSION_MEMORY_MAX_CHARS` from the top if needed

## 4. Backend RPC: tasks.sessionMemory

- [x] 4.1 Add `tasks.sessionMemory` handler in `src/bun/handlers/tasks.ts`: reads the notes file for the given task ID and returns `{ content: string | null }`
- [x] 4.2 Add the RPC type to `src/shared/rpc-types.ts`

## 5. UI: Session Notes in Task Detail Drawer

- [x] 5.1 In the task detail drawer component, add a collapsible "Session Notes" section below the context gauge area
- [x] 5.2 On drawer open, call `tasks.sessionMemory` and store the result; show the section only when content is non-null
- [x] 5.3 Render notes content as markdown (collapsed by default, expand on click)

## 6. Tests

- [x] 6.1 Unit test `readSessionMemory` returns null when file absent
- [x] 6.2 Unit test `writeSessionMemory` writes atomically and content round-trips correctly
- [x] 6.3 Unit test that system prompt assembly includes Session Notes block when notes exist and omits it when absent
- [x] 6.4 Unit test that notes exceeding `SESSION_MEMORY_MAX_CHARS` are truncated from the top
