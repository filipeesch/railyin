## Context

The Pi engine resolves a `SamplingPreset` from `engines.yaml`, filters undefined fields via `filterDefined()`, and injects the result into every LLM API request body through `session.agent.onPayload`. The forwarding mechanism is entirely generic — it spreads any defined field from the resolved preset onto the payload. No changes to the injection path are needed.

Current `SamplingPreset` shape (both `src/bun/config/index.ts` and `src/shared/rpc-types.ts`):
```ts
interface SamplingPreset {
  label?: string;       // UI only
  description?: string; // UI only
  temperature?: number;
  top_p?: number;
  top_k?: number;
  presence_penalty?: number;
}
```

Problem: `filterDefined()` strips only `undefined` values. When a preset has `label: "Balanced"`, that string leaks into every LLM API call payload.

## Goals / Non-Goals

**Goals:**
- Add `repetition_penalty`, `frequency_penalty`, `seed`, `min_p` to `SamplingPreset` in both config and rpc-types
- Fix the `label`/`description` leak by introducing a `SamplingParams` payload-only type returned by `filterDefined` and `resolveSamplingPreset`
- Keep the `SAMPLING_KEYS` allowlist explicit and co-located with the type definition so future additions require a single, obvious touch point

**Non-Goals:**
- No UI changes — the frontend preset selector already displays `params.label`/`params.description` from the full `SamplingPreset`; new numeric params will appear in the detail line automatically if `ConversationInput` renders them
- No per-backend validation — fields are only injected when defined; unsupported backends silently ignore unknown fields (same as today)
- No migration — purely additive interface change, fully backwards compatible

## Decisions

### Decision 1: Introduce `SamplingParams` as a separate type in `sampling-params.ts`

**Chosen approach**: Define `SamplingParams` (payload-only, no UI fields) directly in `sampling-params.ts`, alongside a `SAMPLING_KEYS` set used by `filterDefined` to whitelist fields at runtime.

```ts
// sampling-params.ts
export type SamplingParams = {
  temperature?: number;
  top_p?: number;
  top_k?: number;
  presence_penalty?: number;
  repetition_penalty?: number;
  frequency_penalty?: number;
  seed?: number;
  min_p?: number;
};

const SAMPLING_KEYS = new Set<keyof SamplingParams>([
  "temperature", "top_p", "top_k",
  "presence_penalty", "repetition_penalty",
  "frequency_penalty", "seed", "min_p",
]);

function filterDefined(preset: SamplingPreset): SamplingParams { ... }

export function resolveSamplingPreset(...): SamplingParams | undefined { ... }
```

**Alternatives considered**:
- *Put `SamplingParams` in `config/index.ts` or `rpc-types.ts`*: Rejected — it's a payload shape, not a config/contract shape. Co-locating it with `filterDefined` keeps the type and its enforcer together (Single Responsibility).
- *Omit the SAMPLING_KEYS set and use `keyof SamplingParams` type guards only*: Rejected — `Object.entries` iterates runtime keys; TypeScript types are erased. We need a runtime guard. The set is the simplest and most readable form.
- *Rename `filterDefined` to `extractSamplingParams`*: Valid, but `filterDefined` is an internal (unexported) helper — renaming isn't worth the noise.

### Decision 2: `SamplingPreset` in `rpc-types.ts` gains the same 4 fields

The frontend `SamplingPreset` (used in `ModelInfo.availablePresets`) must mirror the backend shape so the preset selector detail line can surface new params. All four fields are added. `label`/`description` remain — the UI reads them intentionally. No frontend logic change needed.

### Decision 3: No changes to `_applyPresetToSession` in `engine.ts`

The method already spreads `resolved` into `payload as Record<string, unknown>`. Since `resolveSamplingPreset` now returns `SamplingParams | undefined` (a stricter type), the spread is safe. TypeScript inference picks up the narrower type automatically.

## Risks / Trade-offs

- **SAMPLING_KEYS drift** — If a new sampling param is added to `SamplingParams` but forgotten in `SAMPLING_KEYS`, it won't be forwarded. Mitigation: co-location in the same file makes the omission obvious in review; a lint rule or type-level assertion (`type _Exhaustive = Record<keyof SamplingParams, true>`) can be added later if the set grows.
- **Backend silently ignoring unknown fields** — `seed`, `min_p`, `repetition_penalty` are not supported by all backends (Ollama uses `repeat_penalty`, Groq doesn't support either). Users who set unsupported fields get no error; the param is sent and ignored. This is the same behaviour as today for any unknown field. Mitigation: document per-backend support in `engines.yaml.sample`.

## Migration Plan

No migration required. All changes are additive:
1. TypeScript interface fields are optional — existing configs continue to work unchanged
2. `filterDefined` now returns `SamplingParams` — callers that use the spread pattern are unaffected
3. `engines.yaml.sample` comment additions are documentation-only

Rollback: revert the PR. No DB changes, no config format changes.
