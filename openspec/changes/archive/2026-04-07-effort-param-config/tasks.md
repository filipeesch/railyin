## 1. Config Schema

- [x] 1.1 Add optional `effort?: "low" | "medium" | "high" | "max"` field to the `anthropic` object in the workspace config schema in `src/bun/config/index.ts`
- [x] 1.2 Add a commented `anthropic.effort` example to `config/workspace.yaml.sample` with a note that `medium` is a good default for most tasks

## 2. Provider Integration

- [x] 2.1 In `src/bun/ai/index.ts`, read `config.workspace.anthropic?.effort` when building the provider options and pass it to `stream()` as a fallback `effort` value
- [x] 2.2 Ensure explicit `AICallOptions.effort` (e.g. sub-agent `"low"`) takes precedence over the config value — explicit wins

## 3. Tests

- [x] 3.1 Add unit test: when `anthropic.effort` is set to `"medium"` in config and `stream()` is called without explicit effort, the request body includes `output_config: { effort: "medium" }`
- [x] 3.2 Add unit test: when `anthropic.effort` is `"medium"` in config but `stream()` is called with explicit `effort: "low"`, the request body includes `output_config: { effort: "low" }`
- [x] 3.3 Add unit test: when `anthropic.effort` is absent and no explicit effort given, request body has no `output_config` field
