## Why

Sonnet 4.6 defaults to `high` thinking effort. For many workspace tasks (searching, reading files, simple edits) this wastes tokens without improving output quality. Users have no way to configure a lower default — the `effort` parameter has been wired through `AICallOptions` and used for sub-agents (`low`) but there is no config option for the parent agent's effort level.

## What Changes

- Add optional `anthropic.effort` field (`"low" | "medium" | "high" | "max"`) to workspace config schema
- Read `effort` from workspace config in the Anthropic provider and pass it as the default effort to `stream()` calls (parent agent)
- Add `anthropic.effort` example comment to `config/workspace.yaml.sample`

## Capabilities

### New Capabilities
- `effort-param-config`: Exposes `anthropic.effort` as a workspace-level config option that controls the thinking effort used for the parent agent's streaming calls

### Modified Capabilities
- `anthropic-provider`: The `stream()` method SHALL read `effort` from workspace config and apply it when no explicit `effort` is provided in `AICallOptions`

## Impact

- `src/bun/config/index.ts`: New `effort` field on the `anthropic` workspace config object
- `src/bun/ai/index.ts` or constructor: Reads `anthropic.effort` from config and passes to `stream()`
- `config/workspace.yaml.sample`: New commented example for `anthropic.effort`
- Sub-agents are unaffected — they explicitly pass `effort: "low"` which overrides any config default
