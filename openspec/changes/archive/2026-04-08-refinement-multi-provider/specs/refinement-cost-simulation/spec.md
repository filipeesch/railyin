## MODIFIED Requirements

### Requirement: Cost calculation using provider-specific pricing
The proxy SHALL calculate cost estimates using per-provider pricing when available. Each provider config MAY include a `pricing` object with `input`, `cache_write`, `cache_read`, and `output` rates (per million tokens). If a provider does not specify pricing, the proxy SHALL fall back to Anthropic Sonnet pricing: input=$3.00, cache_write=$6.00, cache_read=$0.30, output=$15.00.

#### Scenario: Cost calculation with custom provider pricing
- **WHEN** the active provider has `pricing: { input: 1.00, cache_write: 2.00, cache_read: 0.10, output: 5.00 }`
- **THEN** the cost estimate uses those rates instead of default Sonnet pricing

#### Scenario: Cost calculation falls back to Sonnet pricing
- **WHEN** the active provider has no `pricing` field
- **THEN** the cost estimate uses Sonnet rates: input=$3.00, cache_write=$6.00, cache_read=$0.30, output=$15.00

### Requirement: Scenario cost aggregation in reports
The runner SHALL aggregate cost estimates across all requests in a scenario and include per-scenario totals in the report. The report SHALL also compute an all-cold baseline and show cache savings. Cost aggregations SHALL be grouped by provider, with cross-provider cost comparison included as an informational table.

#### Scenario: Report shows per-provider cost summary
- **WHEN** scenarios complete for providers `lmstudio-qwen` and `anthropic-sonnet`
- **THEN** the report includes separate cost summaries for each provider, each with `total_cost`, `all_cold_cost`, and `cache_savings`

#### Scenario: Cross-provider cost comparison table
- **WHEN** the same scenario runs for 2 providers
- **THEN** the report includes a comparison showing each provider's total_cost, tokens, and cost-per-token side-by-side
