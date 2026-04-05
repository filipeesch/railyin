## Why

Long-running tasks accumulate knowledge the AI model needs to carry forward — which files were changed, what decisions were made, what the user's preferences are. When a conversation gets compacted, the summary captures a snapshot of that moment, but as the work continues and new compactions happen, early context is lost. There is no persistent "memory layer" that survives across multiple compactions. For multi-session or multi-day tasks this means the model progressively loses grounding in the project state.

## What Changes

- Introduce a background session memory service that periodically extracts key facts from the conversation into a persistent markdown notes file (stored per-task)
- The notes file is injected as part of the system prompt on every AI call, before the conversation history — so it survives compactions
- Extraction runs as a non-blocking background call after each AI turn (does not delay main loop)
- The notes file is structured: open decisions, key files and changes, project conventions discovered, user preferences observed
- Users can view the current notes file in the task detail drawer

## Capabilities

### New Capabilities

- `session-memory`: Per-task persistent notes file that survives compaction and is injected into context on every AI call

### Modified Capabilities

- `conversation-compaction`: When compaction runs, the session memory notes SHALL be explicitly referenced in the compaction prompt as additional context the model should assume is available
- `task-detail`: The task detail drawer SHALL expose a "Session Notes" section showing the current contents of the session memory file

## Impact

- `src/bun/workflow/engine.ts`: System prompt assembly — inject session memory notes before conversation history
- `src/bun/workflow/`: New `session-memory.ts` service: background extraction logic, file read/write, prompt for extraction
- `src/bun/handlers/tasks.ts`: New `tasks.sessionMemory` RPC to expose notes content to the UI
- `src/mainview/`: Task detail drawer addition (Session Notes section)
- DB: no schema changes — notes live in a file on disk per task (path derived from task ID)
- No breaking changes
