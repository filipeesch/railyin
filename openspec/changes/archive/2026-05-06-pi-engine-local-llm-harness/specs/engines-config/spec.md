## ADDED Requirements

### Requirement: PiEngineConfig type
A new `PiEngineConfig` is added to the `EngineConfig` union in `src/bun/config/index.ts`.

#### Scenario: Pi engine config shape
- **WHEN** `engines.yaml` contains an entry with `type: pi`
- **THEN** it is parsed as `PiEngineConfig` with fields:
  - `type: "pi"` (discriminant)
  - `model?: string` — default model id (e.g. `"lmstudio/qwen3-8b"`)
  - `providers?: Record<string, { base_url: string }>` — OpenAI-compatible provider endpoints
  - `harness?: { undo_stack_size?: number }` — optional harness tuning (default: `undo_stack_size: 50`)

#### Scenario: Config validation
- **WHEN** an engines.yaml entry has `type: pi` but missing required provider config
- **THEN** a config validation error is surfaced at startup (consistent with existing engine config validation)
