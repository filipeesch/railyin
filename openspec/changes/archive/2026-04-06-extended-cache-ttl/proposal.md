## Why

Anthropic's default prompt cache has a 5-minute TTL. In Railyin's multi-round agent workflows, a single task execution can span 10+ minutes when sub-agents are involved or when the model does extended tool loops. After 5 minutes of no cache refresh, the cached system prompt and tool definitions expire, forcing a full cache write on the next call — consuming both cost (1.25× write tokens) and ITPM budget. Anthropic offers a 1-hour cache TTL at 2× base input price for writes but the same 10% for reads. For long-running agent sessions this is a net win: one write at 2× followed by reads at 10% across many subsequent rounds.

## What Changes

- **`cache_control` TTL parameter**: When constructing Anthropic API requests, the `cache_control` field will use `{ type: "ephemeral", ttl: "1h" }` instead of `{ type: "ephemeral" }` when 1-hour caching is enabled.
- **Configuration toggle**: A workspace-level config option `anthropic.cache_ttl` (values: `"5m"` or `"1h"`, default `"5m"`) controls the TTL used for cache breakpoints.
- **Anthropic-only**: The TTL field is only meaningful for Anthropic's API. Other providers ignore `cache_control` entirely.

## Capabilities

### New Capabilities

_(none)_

### Modified Capabilities

- `anthropic-provider`: `cache_control` blocks support an optional `ttl: "1h"` field when the workspace config enables extended cache duration

## Impact

- `src/bun/ai/anthropic.ts`: `cache_control` object construction adds `ttl` field based on config
- `src/bun/config/index.ts`: Add optional `anthropic.cache_ttl` field to workspace config schema
- `config/workspace.yaml.sample`: Document the new option
- Depends on `prompt-caching` change for the `cache_control` wire format support
- No DB or frontend changes
