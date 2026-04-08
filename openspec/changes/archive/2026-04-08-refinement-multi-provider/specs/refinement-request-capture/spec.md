## MODIFIED Requirements

### Requirement: Full request body capture per proxied request
The proxy SHALL store the complete parsed request body for every POST /v1/messages request it processes, including: model, max_tokens, stream, tools (full array), system (full blocks), and messages (full array). Each capture SHALL also include the `provider_id` and `model_key` from the active provider configuration.

#### Scenario: Proxy captures request body with provider metadata
- **WHEN** the proxy receives a POST /v1/messages request while running provider `lmstudio-qwen`
- **THEN** the proxy stores the full parsed body keyed by request_id with `provider_id: "lmstudio-qwen"` and `model_key: "qwen2.5-coder-32b-instruct"`

### Requirement: Per-request JSON files in report directory
The runner SHALL write each captured request body as a numbered JSON file in a `requests/<provider-id>/<scenario-name>/` subdirectory of the report directory. Each file SHALL contain the raw request body, the inspection record, the cost estimate, and the provider metadata for that request.

#### Scenario: Report directory organizes by provider then scenario
- **WHEN** a scenario `export-markdown` completes with 5 proxied requests for provider `lmstudio-qwen`
- **THEN** the report directory contains `requests/lmstudio-qwen/export-markdown/001.json` through `005.json`

#### Scenario: Per-request file includes provider metadata
- **WHEN** a per-request JSON file is written
- **THEN** it contains `request_id`, `body`, `inspection`, `cost`, `provider_id`, and `model_key`

### Requirement: Mock mode routes through engine
In mock mode, the runner SHALL use the `engine-runner.ts` path to drive scenarios. The mock provider follows the same scenario shape as other providers. The proxy returns scripted SSE responses when the active provider has `type: mock`.

#### Scenario: Mock provider uses scripted responses
- **WHEN** a scenario runs with the active provider having `type: mock`
- **THEN** the proxy returns scripted SSE responses from the scenario's `script` field

#### Scenario: Non-mock provider forwards to backend
- **WHEN** a scenario runs with the active provider having `type: lmstudio` or `type: anthropic`
- **THEN** the proxy forwards requests to the provider's resolved `backendUrl`
