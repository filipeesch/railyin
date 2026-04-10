## Context

Railyin's AI workflow engine sends tool definitions, system prompts, and messages to the Anthropic Messages API. During our cost investigation of execution #96 (~$3 for a simple task), we identified several structural issues — sub-agent tool mismatch breaking cache prefix, flat result limits, and unnecessary tool descriptions — that need iterative validation before deploying fixes to the real API.

Currently, validating changes requires running against production Anthropic at ~$0.30–3.00 per execution. There's no way to verify cache prefix stability, tool schema correctness, or result formatting without spending money. The existing `FakeAIProvider` supports scripted unit tests but doesn't exercise the real `AnthropicProvider` code path (HTTP, SSE parsing, cache_control headers).

LM Studio and Ollama both now support the Anthropic Messages API natively (`POST /v1/messages` with `input_schema` tools, `tool_use` SSE events, streaming). This means a local model can be used through the exact same `AnthropicProvider` code path — no format translation needed.

## Goals / Non-Goals

**Goals:**
- Validate structural properties (cache prefix stability, tool schemas, result sizes) at $0 via mock mode
- Validate behavioral quality (model uses tools correctly) at $0 via local model (LM Studio)
- Validate real cache/cost behavior via targeted Anthropic runs (~$0.80 for before/after)
- Automate the full implement → measure → evaluate → iterate loop via Copilot skill
- Make this permanent, reusable infrastructure for any future AI workflow change

**Non-Goals:**
- Replacing the existing unit test suite or `FakeAIProvider` — those remain for fast in-process testing
- Building a general-purpose LLM benchmarking framework
- Supporting providers other than Anthropic Messages API in the proxy
- Achieving feature parity with Anthropic's cache behavior — the simulator approximates prefix-matching behavior for validation, not production use
- Running Layer 2 (local model) in CI — it requires a GPU-capable machine

## Decisions

### 1. Single proxy, three modes — not three separate servers

**Decision**: One `refinement/proxy.ts` Bun.serve instance with a `--mode` flag (mock/local/live) that determines the backend, while the inspector and cache simulator always run.

**Rationale**: The inspector/cache-sim logic is identical across modes. Splitting into three servers would duplicate it. A single proxy also means one port config, one start/stop lifecycle, one log format.

**Alternatives considered**: Separate mock-server.ts and facade.ts — rejected because the Anthropic format translation layer we originally planned is unnecessary now that LM Studio and Ollama speak Anthropic natively.

### 2. No format translation — LM Studio speaks Anthropic natively

**Decision**: The proxy forwards requests to the backend **unmodified** in all three modes. No Anthropic ↔ OpenAI translation.

**Rationale**: LM Studio (since late 2025) and Ollama (v0.14.0+, January 2026) both implement `POST /v1/messages` with Anthropic wire format: `input_schema` tools, `tool_use`/`tool_result` content blocks, SSE events (`message_start`, `content_block_delta`, etc.). This means the same `AnthropicProvider` code path is exercised in all layers. The facade architecture we initially explored is unnecessary.

**Risk**: LM Studio or Ollama may not support every Anthropic feature (e.g., `cache_control` blocks are probably ignored, `thinking` mode may degrade). Mitigation: the proxy strips/adapts fields that cause errors, and these gaps don't affect the structural validations.

### 3. SHA256 prefix hash for cache simulation

**Decision**: The cache simulator computes `SHA256(JSON.stringify(system) + JSON.stringify(tools))` per request and compares it to a rolling map keyed by execution context. Matching hash → simulated HIT, mismatching → simulated WRITE.

**Rationale**: Anthropic's cache uses a prefix-matching scheme where `[system, tools, messages]` form the prefix. If `system` + `tools` differ between requests (e.g., parent vs sub-agent), the prefix breaks and a full cache write occurs. This hash approximation is sufficient to detect the sub-agent tool mismatch bug without needing Anthropic's actual cache logic.

**Limitation**: Does not simulate message-level prefix matching (where early messages in a conversation may still cache). Sufficient for detecting the primary issue (tool set mismatch).

### 4. YAML scenarios with scripted responses (mock mode)

**Decision**: Scenario files define a sequence of turns with scripted model responses and assertions. In mock mode, the proxy reads the script and returns SSE events matching the scripted tool_use/text blocks. In local/live mode, scenarios provide the initial user message and assertions only — the model generates real responses.

**Rationale**: Scripted scenarios enable deterministic testing of the full engine loop (tool call → execute → return result → next turn) without any model. Assertions about tool hashes, cache prefix, max_tokens, and tool inclusion/exclusion work identically across all modes.

### 5. LM Studio as default Layer 2 backend, configurable

**Decision**: Default to LM Studio on `http://localhost:1234` for Layer 2. The `--backend` flag allows any Anthropic-compatible endpoint (Ollama on `:11434`, etc.).

**Rationale**: User preference, plus LM Studio supports MLX on Apple Silicon (faster inference). The `lms` CLI enables full automation: `lms server start`, `lms load qwen3.5:9b --gpu=max`, `lms unload --all`, `lms server stop`.

### 6. One-line AnthropicProvider base_url fix

**Decision**: Change `instantiateProvider()` to pass `config.base_url` to `AnthropicProvider` constructor instead of `undefined`.

**Rationale**: This is the minimal enablement change. `AnthropicProvider` already accepts `baseUrl` in its constructor (defaults to `https://api.anthropic.com`). The config already has `base_url` as an optional field. Just needs to be wired through. No new config schema, no new provider type.

### 7. Top-level `refinement/` folder

**Decision**: Place all harness code in `refinement/` at the project root, not inside `src/` or `test/`.

**Rationale**: This is permanent optimization infrastructure, not app code (doesn't ship) and not unit tests (has its own servers, scenarios, reports). It deserves its own namespace. The `.gitignore` will exclude `refinement/reports/` (auto-generated).

### 8. Deep-with-checkpoints automation in the Copilot skill

**Decision**: The `/refine` skill implements task groups autonomously, measuring after each group. It stops on regression (metric worsened) or completion (all groups done). Reports are shown after each checkpoint.

**Rationale**: Shallow automation (one task at a time, ask user) adds friction to a loop that may run 10+ iterations. Deep automation (all tasks, no stops) risks compounding a mistake. Group-level checkpoints balance speed and safety.

### 9. Reports as JSON files in refinement/reports/

**Decision**: Each run produces a timestamped JSON file with all metrics. The comparison is always baseline vs latest run. Reports are git-ignored.

**Rationale**: JSON is easy to diff programmatically and easy for the Copilot skill to parse. Timestamped files preserve history for trend analysis. Git-ignored because they're machine-specific (depend on local model, hardware speed, etc.).

## Risks / Trade-offs

- **[LM Studio Anthropic compat gaps]** → LM Studio or Ollama may not handle all Anthropic features (cache_control, thinking, multi-tool responses). Mitigation: proxy can strip unsupported fields; we test compat in Layer 2 before relying on it. Bridge (Anthropic → OpenAI translation) is plan B.
- **[Local model quality]** → Qwen 3.5 9B may not follow tool schemas as reliably as Claude. Mitigation: Layer 2 validates behavioral patterns, not production quality. Discrepancies are expected and documented in reports.
- **[Cache sim accuracy]** → The SHA256 prefix approximation doesn't capture all Anthropic caching nuances (e.g., partial message prefix hits). Mitigation: Layer 3 (real Anthropic) provides ground truth; cache sim only needs to catch the big issues (tool set mismatch).
- **[Copilot skill complexity]** → The auto-improve loop has many moving parts (start servers, run scenarios, parse reports, implement code, compare). Mitigation: each component is independently testable; the skill orchestrates but each step can be run manually.
