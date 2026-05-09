## Context

The Pi engine (`src/bun/engine/pi/engine.ts`) wraps the `@earendil-works/pi-coding-agent` SDK and drives local LLM providers (LM Studio, Ollama, OpenAI-compatible). The Pi SDK has native auto-compaction built in — it monitors token usage after every assistant turn and triggers a summarization pass when `contextTokens > contextWindow - reserveTokens` (default `reserveTokens = 16,384`).

Three bugs combine to break compaction entirely:

1. **Wrong context window** — `buildModel()` hardcodes `contextWindow: 32_768` regardless of the actual model. Pi SDK fires compaction at ~16k tokens, which is too early, and it uses the wrong window for all threshold math.
2. **Events dropped** — `event-translator.ts` falls through `default: return []` for `compaction_start` / `compaction_end`. The SDK's compaction results never become EngineEvents.
3. **`compact()` is a no-op** — `PiEngine.compact()` only resets hash cache flags. It never calls `session.compact()` or persists a summary row to the DB.

The result: the Pi SDK may compact its internal `.jsonl` session file, but Railyin's DB accumulates messages without bound, the `ContextEstimator` sees no anchor, and the console prints `"128% of model limit"`.

## Goals / Non-Goals

**Goals:**
- Pi engine compaction writes a `compaction_summary` DB row (anchor) equivalent to how Copilot does it
- `PiEngineConfig` exposes a `context_window` field so operators can match their model's real window
- Pi SDK native auto-compaction events are translated and flow through the existing stream pipeline
- `PiEngine.compact()` becomes functional for manual and cross-engine-context triggered compaction

**Non-Goals:**
- Changing how other engines (Copilot, Claude, OpenCode) handle compaction
- Implementing a Railyin-side token counter for Pi (we rely on the SDK's own tracking)
- Exposing UI controls for Pi compaction settings

## Decisions

### D1 — Rely on Pi SDK's native auto-compaction; don't duplicate threshold logic

**Decision:** Wire the SDK's `compaction_end` event into the Railyin pipeline rather than building our own threshold check outside the SDK.

**Rationale:** The SDK already does the threshold math correctly against the model's actual `contextWindow`. Adding a duplicate Railyin-side check around `ContextEstimator` would be fragile and redundant. The cross-engine-context 75% check remains as a safety net for engine-switch scenarios.

**Alternative considered:** Add a pre-execution hook in `HumanTurnExecutor`/`TransitionExecutor` that calls `compact()` when fraction > 0.75. Rejected — this would be reactive (fires too late, after context is already large) and wouldn't integrate with the SDK's own overflow recovery path.

### D2 — Translate `compaction_end` into a `compaction_done` EngineEvent

**Decision:** When `event.type === "compaction_end"` and `event.result` is defined (not aborted), translate to `{ type: "compaction_done", summary: result.summary }`. The existing `stream-processor` path for `compaction_done` already writes the `compaction_summary` DB row — no changes needed there.

**Rationale:** Reuses the established Copilot compaction path in `stream-processor.ts`. Minimal blast radius.

**Also translate:** `compaction_start` → `{ type: "compaction_start" }` so the UI can show an in-progress indicator (already handled by the stream processor).

### D3 — `PiEngineConfig.context_window` with fallback to 128k

**Decision:** Add `context_window?: number` to `PiEngineConfig`. When not configured, default to `128_000` (instead of current `32_768`).

**Rationale:** 128k is a common local model context window (Llama 3, Qwen, Mistral NeMo, etc.) and is a much safer default than 32k. Operators running smaller models (e.g. 8k Mistral) should set it explicitly. The config field should be documented in `engines.yaml.sample`.

### D4 — `PiEngine.compact()` calls `session.compact()` and persists the summary

**Decision:** When `compact()` is called, find the live Pi session for the conversation, call `await session.compact()`, and append the result summary as a `compaction_summary` message row via the existing `appendMessage` helper.

**Rationale:** This makes manual compaction (user-triggered or cross-engine-context triggered) functional. The DB row acts as an anchor for `ContextEstimator`.

**Edge case:** If no live session exists (e.g. task not currently executing), log a warning and return without error. Compaction in this case cannot proceed without a live model call.

## Risks / Trade-offs

- **SDK compaction requires a live model call** → If the local provider is offline, auto-compaction fails silently inside the SDK (it already handles this gracefully with `compaction_end.aborted: true`). We skip writing the DB row when `aborted: true`. No Railyin crash.
- **`context_window` mismatch** → If the operator sets a wrong value, the SDK compacts too early or too late. This is operator-visible through logs. Documented in `engines.yaml.sample`.
- **Double-write risk** → Both native auto-compaction (via event) and manual `compact()` call could write a row. The stream-processor already guards against duplicate `compaction_summary` rows (`if (lastMsg?.type === "compaction_summary") break`). No regression.
- **Existing 32k sessions** → Sessions created under the old 32k default may have compaction history at 32k boundaries. After the fix, the SDK will use the new `contextWindow` value. Existing `.jsonl` session data is unaffected.

## Open Questions

- None blocking implementation.
