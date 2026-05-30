## Context

The Pi engine currently passes no sampling parameters to the underlying LLM API. All creative/precision tradeoffs are left to provider defaults. Different workflow columns have meaningfully different needs — creative exploration benefits from high temperature while code writing benefits from low temperature. This feature adds config-driven sampling presets that columns can reference by name.

**Current state:**
- `PiEngineConfig` has `context_window`, `compaction_strategy`, providers — no sampling fields
- `WorkflowColumnConfig` has `model`, `tools`, `prompt` — no sampling field
- `ExecutionParams` carries `contextWindowOverride` (resolved from DB) — no sampling field
- Pi SDK's `Agent` exposes `onPayload` — a raw request body interceptor not yet wired
- Sessions are reused per `conversationId` (critical: `onPayload` must be set per-execution, not per-session-creation)

## Goals / Non-Goals

**Goals:**
- Allow defining named sampling parameter presets in `engines.yaml` under the Pi engine entry
- Allow workflow columns to reference a preset by name via `sampling_preset: <name>`
- Fallback chain: column preset → engine `default_sampling_preset` → no override
- Inject resolved sampling values via `session.agent.onPayload` per execution
- Support: `temperature`, `top_p`, `top_k`, `presence_penalty`
- Keep `TransitionExecutor` engine-agnostic (pass preset name, not values)

**Non-Goals:**
- UI for editing sampling presets (YAML-only for now)
- DB storage of sampling parameters
- Per-task or per-conversation sampling overrides
- Support for other engines (Claude, Copilot, OpenCode)

## Decisions

### Decision 1: Presets live under the Pi engine entry in `engines.yaml`

**Chosen**: `sampling_presets` map + `default_sampling_preset` string on the Pi engine config object.

```yaml
engines:
  - id: pi
    type: pi
    default_sampling_preset: balanced
    sampling_presets:
      balanced:
        temperature: 0.8
        top_p: 0.95
      precise:
        temperature: 0.2
        top_p: 0.85
      creative:
        temperature: 1.2
        top_p: 0.98
        presence_penalty: 0.3
```

**Alternatives considered:**
- Global presets file: unnecessary indirection, presets are Pi-specific
- Inline values on column: verbose, no reuse across columns

### Decision 2: Columns reference presets by name

```yaml
columns:
  - id: explore
    sampling_preset: creative
  - id: implement
    sampling_preset: precise
```

**Rationale**: Decouples preset definitions from workflow config. Changing a preset value in `engines.yaml` propagates to all columns referencing it.

### Decision 3: `ExecutionParams` carries `samplingPresetName?: string` (name, not values)

**Rationale**: `TransitionExecutor` is engine-agnostic and must not know about Pi-specific preset resolution. The name travels through the params builder unchanged; PiEngine resolves it against its own config.

### Decision 4: Injection via `session.agent.onPayload` per execution

**Rationale**: `StreamOptions.temperature` is the only natively typed param; the rest (`top_p`, `top_k`, `presence_penalty`) are not modeled in the SDK — `onPayload` is the only reliable raw-body injection point.

**Critical subtlety**: Sessions are reused across executions (`PiEngine.sessions` map). `onPayload` is a mutable property on the `Agent` instance. It MUST be set on every `createManagedExecution()` call (not once at session creation) so the correct preset for the current column is applied. If no preset resolves, `onPayload` MUST be reset to `undefined` to avoid leaking a prior execution's values.

### Decision 5: New pure function `resolveSamplingPreset()` in its own file

**Rationale**: Keeps `engine.ts` from growing. A pure function is trivially testable. File: `src/bun/engine/pi/sampling-params.ts`.

```typescript
export function resolveSamplingPreset(
  presetName: string | undefined,
  config: PiEngineConfig
): SamplingPreset | undefined
```

Uses `filterDefined()` before merging into `onPayload` to avoid sending `undefined` fields to the LLM API.

## Risks / Trade-offs

- **[Risk] onPayload leakage across executions** → Mitigation: explicitly reset `session.agent.onPayload = undefined` when no preset resolves, tested as a scenario.
- **[Risk] Unknown preset name** → Mitigation: log a warning and fall back to no override (don't throw — misconfigured preset name shouldn't crash an execution).
- **[Risk] SDK future changes to onPayload signature** → Low risk; `onPayload` is the documented extension point.
- **[Trade-off] Config-driven only** → No UI for tuning presets. Acceptable for now; users can edit `engines.yaml` directly via the engines editor.

## Migration Plan

No DB migration required. New YAML fields are optional — existing configs without `sampling_presets` continue to work unchanged. `config/engines.yaml.sample` is updated with documented examples.

## Open Questions

None — all decisions finalized during exploration.
