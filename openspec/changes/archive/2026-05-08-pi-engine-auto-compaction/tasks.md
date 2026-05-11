## 1. Config Type

- [x] 1.1 Add `context_window?: number` to `PiEngineConfig` in `src/bun/config/index.ts`
- [x] 1.2 Document `context_window` in `config/engines.yaml.sample` with a comment explaining the default and when to override

## 2. Context Window in buildModel()

- [x] 2.1 Update `buildModel()` in `src/bun/engine/pi/engine.ts` to read `context_window` from `this.config` and use it as `model.contextWindow`
- [x] 2.2 Change `DEFAULT_CONTEXT_WINDOW` from `32_768` to `128_000`

## 3. Event Translation

- [x] 3.1 Handle `compaction_start` in `translateEvent()` in `src/bun/engine/pi/event-translator.ts` — return `[{ type: "compaction_start" }]`
- [x] 3.2 Handle `compaction_end` in `translateEvent()` — return `[{ type: "compaction_done", summary }]` when `!event.aborted && event.result?.summary`
- [x] 3.3 Return `[]` for `compaction_end` when aborted or result is missing

## 4. Functional compact()

- [x] 4.1 In `PiEngine.compact()`, look up the live `AgentSession` for `conversationId`
- [x] 4.2 If session exists, call `await session.compact()` and capture the result
- [x] 4.3 If `result.summary` is truthy, call `appendMessage(db, taskId ?? 0, conversationId, "compaction_summary", null, result.summary)` to persist the anchor row
- [x] 4.4 If no session exists, log a warning and return without error

## 5. Tests

- [x] 5.1 Add unit tests for `translateEvent` covering `compaction_start`, successful `compaction_end`, aborted `compaction_end`, and missing result cases
- [x] 5.2 Verify `buildModel()` uses `config.context_window` when provided and `128_000` when absent
