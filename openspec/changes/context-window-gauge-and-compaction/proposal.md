## Why

As tasks accumulate long conversations, the AI context window fills up silently — the only feedback today is a text warning banner after the fact. Users have no visibility into how close they are to the limit, no way to auto-detect a model's actual context size, and no mechanism to compact a conversation to reclaim headroom.

## What Changes

- The `models.list` RPC returns `{ id, contextWindow }` objects instead of plain strings, auto-detecting context window size from provider endpoints where available
- `ai.model` in `workspace.yaml` becomes optional (was required); the workspace-level default model is no longer mandatory
- `ai.context_window_tokens` in `workspace.yaml` becomes a manual override / fallback only when the API does not return context size
- A context usage gauge is displayed to the right of the model selector in the task drawer, showing estimated token usage vs. model limit
- A manual "Compact" button lets users trigger conversation compaction at any time
- Conversation compaction auto-triggers when context usage reaches 90% before the next send
- Compaction replaces old messages with an AI-generated summary stored as a `compaction_summary` message type; `compactMessages()` uses the most recent summary as the history baseline

## Capabilities

### New Capabilities
- `context-gauge`: Real-time context usage gauge in the task drawer UI showing estimated tokens / context window with tooltip detail
- `conversation-compaction`: AI-triggered conversation compaction that summarizes accumulated history into a compact marker, with both manual and auto-trigger modes

### Modified Capabilities
- `model-selection`: `models.list` RPC now returns `{ id: string, contextWindow: number | null }[]` instead of `string[]`; `ai.model` in workspace YAML becomes optional

## Impact

- `src/bun/handlers/tasks.ts` — `models.list` handler change (return type, response parsing)
- `src/bun/workflow/engine.ts` — `compactMessages()` updated to use compaction summary; new `compactConversation()` function; auto-compact logic in send path
- `src/bun/config/index.ts` — `ai.model` validation loosened to optional
- `src/shared/rpc-types.ts` — new `models.list` return type; new `tasks.compact` RPC; new `tasks.contextUsage` RPC
- `src/mainview/components/TaskDetailDrawer.vue` — gauge + Compact button UI
- `src/mainview/stores/task.ts` — `availableModels` shape change; context usage state
- New `compaction_summary` conversation message type persisted in DB
