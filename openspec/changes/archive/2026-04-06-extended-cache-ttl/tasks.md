## 1. Config Schema

- [x] 1.1 Add optional `anthropic.cache_ttl` field (enum: `"5m"` | `"1h"`, default `"5m"`) to workspace config schema in `src/bun/config/index.ts`
- [x] 1.2 Add `anthropic.cache_ttl` example to `config/workspace.yaml.sample`

## 2. Wire Format

- [x] 2.1 In `anthropic.ts`, read `cache_ttl` from config and apply `ttl: "1h"` to `cache_control` blocks when configured (after `prompt-caching` has added `cache_control` support)

## 3. Tests

- [x] 3.1 Write a unit test verifying `cache_control` has no `ttl` field when config is `"5m"` or absent
- [x] 3.2 Write a unit test verifying `cache_control` includes `ttl: "1h"` when config is `"1h"`
