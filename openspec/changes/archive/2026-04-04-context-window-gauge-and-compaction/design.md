## Context

Tasks accumulate conversation history indefinitely. The AI receives the full history on every turn via `compactMessages()`, which today only filters message types and truncates oversized tool results. There is no summarization, no history pruning, and no UI feedback about how much context is in use.

The `models.list` RPC fetches `/v1/models` but discards all fields except `id`, losing `context_length` that LM Studio and OpenRouter populate. The workspace YAML requires `ai.model` to be set and uses `context_window_tokens` as the only source of truth for the model's context limit.

## Goals / Non-Goals

**Goals:**
- Auto-detect context window size from the `/v1/models` response per selected model
- Make `ai.model` optional in workspace YAML; `ai.context_window_tokens` becomes a fallback override
- Show a live context usage gauge next to the model selector in the task drawer
- Allow the user to compact conversation history manually at any time
- Auto-compact immediately before a message send when usage ≥ 90%
- Compaction uses the same model as the task
- Preserve full conversation history in DB (append-only invariant maintained)

**Non-Goals:**
- Streaming compaction feedback (compaction is a synchronous pre-send step)
- Per-provider special casing beyond the common `context_length` field
- Purging or deleting old messages
- Ollama's separate `/api/show` endpoint (future work)

## Decisions

### D1: `models.list` returns structured objects, not strings

`models.list` changes return type from `string[]` to `{ id: string, contextWindow: number | null }[]`. The field `context_length` is read from the raw model object and mapped to `contextWindow`. Fallback chain: API field → `null`.

Considered: keeping `string[]` and adding a separate `models.contextWindow` RPC. Rejected — two round trips for data already in the same response.

The frontend derives the window for the active model from this list and falls back to `config.context_window_tokens ?? 128_000`.

### D2: `ai.model` becomes optional; validation loosened

Removing the "required" guard in `config/index.ts`. The fallback chain for `resolvedModel` throughout `engine.ts` becomes:

```
task.model ?? config.workspace.ai.model ?? null
```

If null, the provider uses its own default (all modern providers handle a missing `model` field gracefully, or the first model in the list is used at call time). The workspace spec will be updated to reflect this.

Considered: always requiring a model to be set before a task can run, blocking execution. Rejected — too disruptive; model can already be set per-task from the UI.

### D3: Context usage is estimated at message-assembly time

`estimateContextWarning()` today counts only stored message chars. The gauge must reflect what is actually sent: stored messages + injected system messages (stage_instructions + worktree context). The worktree context block is ~1,400 chars (~350 tokens). A new exported function `estimateContextUsage(taskId)` returns `{ usedTokens: number, maxTokens: number }` using the same char-to-token approximation (÷4) but adds a fixed overhead for injected system messages.

### D4: Gauge is stale-on-load, not live

The gauge reads usage when the drawer opens and after each execution completes (reusing the existing `onTaskUpdated` signal). It does not poll or update during token streaming. This avoids any new push mechanism and is good enough for the use case.

### D5: Compaction is append-only — a new `compaction_summary` message type

Compaction does NOT delete messages. It appends a `compaction_summary` message whose content is the AI-generated summary. `compactMessages()` is updated: if a `compaction_summary` message exists in history, only messages after the most recent one are sent to the LLM (plus the summary itself as a system message). Pre-compaction messages are still in DB but invisible to the LLM.

The UI can render pre-summary messages greyed out or behind an expand toggle.

### D6: Compaction prompt uses the task's own model

The compaction AI call uses `task.model ?? config.workspace.ai.model`. It is a single non-streaming `turn()` call with a dedicated system prompt:

> "You are a conversation summarizer. Given the conversation history below, produce a compact summary that preserves: key decisions made, code or files changed, the current state of the work, and any open questions. Be concise but complete. Output only the summary text."

The summary is stored as the `compaction_summary` message.

### D7: Auto-compact on send at ≥ 90%

In `handleHumanTurn()`, before assembling messages for the AI, check `estimateContextUsage()`. If `usedTokens / maxTokens ≥ 0.90`, trigger compaction synchronously first, then proceed with the send. The user sees the compaction summary message appear in the timeline before the response arrives.

Manual compact: a `tasks.compact` RPC callable at any time, not gated on threshold.

### D8: `tasks.contextUsage` RPC for gauge data

New RPC `tasks.contextUsage(taskId)` → `{ usedTokens, maxTokens, fraction }`. Called by the frontend when the drawer opens and after `onTaskUpdated`. Does not require an execution to be running.

## Risks / Trade-offs

- **Token estimation accuracy** — char/4 is a rough heuristic. Real token counts vary by model and content. The gauge may read 5-10% off. Acceptable given no tokenizer library is in use. → No mitigation, document as approximate.
- **Compaction quality** — A poor summary loses context the model needs. → Use a clear structured prompt; user can always view pre-compaction history in the UI.
- **Auto-compact adds latency to the first overloaded send** — The compaction call runs synchronously before the response. Could add 2-5s. → Show a "Compacting…" status message in the conversation while it runs.
- **Providers that don't support `/v1/models` or omit `context_length`** — Fall through to `context_window_tokens` config, then to 128k default. OpenAI proper doesn't return context_length; users with OpenAI need the YAML override. → Document in workspace.yaml comments.
- **`model` optional means no default** — If the user has no model selected and `ai.model` is absent from YAML, execution fails with a provider error. → Show a validation message in the UI if `task.model` is null and no models are returned.

## Migration Plan

1. `workspace.yaml` `ai.model` validation is loosened — no migration needed for existing configs (field stays valid if present).
2. `models.list` return type change is a breaking API change between frontend and backend — both updated in the same PR. The frontend `availableModels` store field changes from `string[]` to `{ id: string; contextWindow: number | null }[]`.
3. New `compaction_summary` message type: no DB migration needed (existing `type` column is a plain string, already handles arbitrary values).
4. New `tasks.compact` and `tasks.contextUsage` RPCs: additive.
