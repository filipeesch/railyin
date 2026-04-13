## Why

The Copilot engine's chat timeline has several interrelated issues that degrade the user experience during streaming. The status bar receives raw tool output (multi-KB file contents, terminal buffers), making it unreadable. Tool calls are not visually associated with the reasoning phase that triggered them. Toast notifications fire for the active task the user is already watching. And read_file tool results show line numbers starting from 1 regardless of the actual range requested.

## What Changes

- Filter internal tool progress/partial-result events so they don't pollute the status bar with raw output
- Truncate and summarize visible status messages to keep the ephemeral status bar readable
- Emit lightweight progress indicators for internal tool activity so the UI doesn't appear frozen
- Nest tool_call blocks as children of the preceding reasoning block when tools fire after reasoning
- Pass startLine offset from tool call arguments to ReadView for correct line numbering
- Suppress toast notifications for the currently active/visible task

## Capabilities

### New Capabilities

_None — all changes modify existing capabilities._

### Modified Capabilities

- `copilot-engine`: Status events from `tool.execution_partial_result` and `tool.execution_progress` need internal-tool filtering and content sanitization before becoming EngineEvents
- `unified-ai-stream`: The orchestrator's `consumeStream` needs to associate tool_call blocks with the preceding reasoning context via parentBlockId
- `task-detail`: ReadView needs to accept a start-line offset; toast notifications need to be suppressed for the active task; status bar rendering needs to handle truncated content gracefully

## Impact

- `src/bun/engine/copilot/events.ts` — translateEvent for partial_result/progress filtering
- `src/bun/engine/orchestrator.ts` — consumeStream tool_call parentBlockId logic and reasoning flush timing
- `src/mainview/components/ReadView.vue` — line number offset prop
- `src/mainview/components/ToolCallGroup.vue` — parse and pass startLine to ReadView
- `src/mainview/components/StreamBlockNode.vue` — render tool_call children inside reasoning bubbles
- `src/mainview/App.vue` — suppress toast for active task
- `src/mainview/stores/task.ts` — no structural changes, just receives cleaner events
