## Why

The Pi engine ignores the model's true context window, hardcodes a 32k token limit, and never surfaces the Pi SDK's native auto-compaction results back into Railyin's database — causing conversations to silently grow past 100% of the model limit with no compaction relief, as evidenced by recurring `"128% of model limit"` console warnings.

## What Changes

- Fix `buildModel()` in `PiEngine` to use a configurable `context_window` from `PiEngineConfig` (with a sensible default matching typical local models)
- Translate Pi SDK `compaction_end` events in `event-translator.ts` into a `compaction_done` EngineEvent carrying the compaction summary text
- Make `PiEngine.compact()` actually invoke `session.compact()` on the Pi SDK session and persist the resulting summary as a `compaction_summary` DB row

## Capabilities

### New Capabilities

- `pi-engine-compaction`: Pi engine surfaces compaction lifecycle (start/done) and persists compaction summaries to the Railyin conversation DB, equivalent to Copilot's existing compaction flow

### Modified Capabilities

- `pi-engine`: `PiEngineConfig` gains an optional `context_window` field; `compact()` becomes functional

## Impact

- `src/bun/engine/pi/engine.ts` — `buildModel()` context window, `compact()` implementation
- `src/bun/engine/pi/event-translator.ts` — handle `compaction_start` / `compaction_end` events
- `src/bun/config/index.ts` — `PiEngineConfig` type gains `context_window?: number`
- `config/engines.yaml.sample` — document the new `context_window` field
- No breaking changes to public API or RPC types
