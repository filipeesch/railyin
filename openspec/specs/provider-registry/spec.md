## Purpose
The refinement harness SHALL load and manage provider definitions from `config/providers.yaml`, supporting multiple provider types and selection via CLI flags.

## Requirements

### Requirement: providers.yaml configuration file
The refinement harness SHALL load provider definitions from `config/providers.yaml`. The file SHALL declare `stable_commit` (git ref), `runs_per_scenario` (integer, default 2), `default_providers` (array of provider IDs for quick runs), and `providers` (array of provider objects).

#### Scenario: Valid providers.yaml is loaded
- **WHEN** the runner starts and `config/providers.yaml` exists with valid YAML
- **THEN** the runner parses all provider entries and makes them available for selection

#### Scenario: Missing providers.yaml exits with error
- **WHEN** the runner starts and `config/providers.yaml` does not exist
- **THEN** the runner exits with code 1 and prints "config/providers.yaml not found. Copy config/providers.yaml.sample and configure your providers."

#### Scenario: providers.yaml.sample is committed to git
- **WHEN** a developer clones the repository
- **THEN** `config/providers.yaml.sample` exists with example provider entries for mock, lmstudio, and anthropic types

### Requirement: Provider type discriminated union
Each provider entry SHALL have a `type` field with one of: `mock`, `lmstudio`, `anthropic`. The `type` field determines lifecycle behavior, backend routing, and required fields.

#### Scenario: Mock provider requires no backend fields
- **WHEN** a provider has `type: mock`
- **THEN** validation passes without `host`, `port`, or `api_key` fields

#### Scenario: LM Studio provider requires model_key
- **WHEN** a provider has `type: lmstudio`
- **THEN** validation requires `model_key` and `host` (default `localhost`), `port` (default `1234`)

#### Scenario: Anthropic provider requires api_key
- **WHEN** a provider has `type: anthropic` and neither `api_key` in the provider config nor `ANTHROPIC_API_KEY` in environment exists
- **THEN** validation fails with "Provider '<id>' requires api_key or ANTHROPIC_API_KEY environment variable"

### Requirement: Provider selection via --providers flag
The runner SHALL accept a `--providers` flag with a comma-separated list of provider IDs. Only the specified providers SHALL be executed. If omitted, the runner SHALL use `default_providers` from the YAML file.

#### Scenario: Explicit provider selection
- **WHEN** the runner is invoked with `--providers lmstudio-qwen,anthropic-sonnet`
- **THEN** only providers with IDs `lmstudio-qwen` and `anthropic-sonnet` are executed

#### Scenario: Default providers when flag omitted
- **WHEN** the runner is invoked without `--providers` and `default_providers: [mock-default]` is set
- **THEN** only the `mock-default` provider is executed

#### Scenario: Unknown provider ID exits with error
- **WHEN** the runner is invoked with `--providers nonexistent`
- **THEN** the runner exits with code 1 and prints "Unknown provider: nonexistent. Available: mock-default, lmstudio-qwen, ..."

### Requirement: Scenario selection via --scenarios flag
The runner SHALL accept a `--scenarios` flag with a comma-separated list of scenario names. Only the specified scenarios SHALL be executed. If omitted, all scenarios are run.

#### Scenario: Explicit scenario selection
- **WHEN** the runner is invoked with `--scenarios export-markdown,new-tool`
- **THEN** only the `export-markdown` and `new-tool` scenarios are executed for each selected provider

#### Scenario: All scenarios when flag omitted
- **WHEN** the runner is invoked without `--scenarios`
- **THEN** all scenario YAML files in the scenarios directory are loaded and executed

### Requirement: Backward-compatible --mode flag
The runner SHALL continue to accept `--mode mock` as shorthand for selecting the default mock provider. `--mode auto` SHALL continue to trigger the auto loop, but using provider-based execution internally.

#### Scenario: --mode mock selects default mock provider
- **WHEN** the runner is invoked with `--mode mock`
- **THEN** the runner selects the first provider with `type: mock` from providers.yaml

#### Scenario: --mode auto uses provider-based loop
- **WHEN** the runner is invoked with `--mode auto`
- **THEN** the auto loop runs using providers from providers.yaml instead of hardcoded mock/local/live sequence

### Requirement: Provider config exposes backendUrl
Each non-mock provider SHALL resolve a `backendUrl` from its config: for lmstudio, `http://<host>:<port>`; for anthropic, `https://api.anthropic.com`. The proxy receives this URL instead of a CLI flag.

#### Scenario: LM Studio provider resolves backend URL
- **WHEN** a provider has `type: lmstudio`, `host: 192.168.1.50`, `port: 1234`
- **THEN** the resolved backendUrl is `http://192.168.1.50:1234`

#### Scenario: Anthropic provider resolves backend URL
- **WHEN** a provider has `type: anthropic`
- **THEN** the resolved backendUrl is `https://api.anthropic.com`
