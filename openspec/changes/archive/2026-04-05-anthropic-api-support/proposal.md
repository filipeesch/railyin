## Why

The app currently supports only a single AI provider at a time, configured as a single `ai:` block in `workspace.yaml`. Users who want to compare models across providers (e.g., run Claude on Anthropic directly while also having local LM Studio models) must reconfigure the entire workspace. Additionally, Anthropic's native API — which has a different wire format — cannot be used at all today. This limits model diversity and blocks access to Anthropic's full feature set including extended thinking.

## What Changes

- **BREAKING**: `workspace.yaml` gains a `providers:` list replacing the single `ai:` block. The old `ai:` block is auto-migrated for backward compatibility on load.
- Multi-provider configuration: users can list any number of providers (`anthropic`, `openrouter`, `lmstudio`, `openai-compatible`) simultaneously in `workspace.yaml`.
- New `AnthropicProvider` implementation with native Anthropic API wire format (separate from the OpenAI-compatible provider).
- Model IDs become fully-qualified: `{providerId}/{modelId}` (e.g., `anthropic/claude-3-5-sonnet-20241022`).
- `models.list` RPC aggregates models from all configured providers, prefixed with their provider ID.
- Provider resolution: the engine resolves the correct provider at execution time from the task's qualified model string.
- Tasks with no resolvable model are moved to `awaiting_user` status instead of failing hard.
- Extended thinking (Anthropic's reasoning tokens) is surfaced through the existing `ReasoningBubble` component via the same `{ type: "reasoning" }` stream event — no UI changes needed.

## Capabilities

### New Capabilities

- `multi-provider-config`: Configuration of multiple AI providers simultaneously in `workspace.yaml`, with a `providers:` list replacing the single `ai:` block and backward-compat auto-migration.
- `anthropic-provider`: Native Anthropic API provider (`/v1/messages` wire format, `x-api-key` auth, system message extraction, tool result format mapping, streaming `thinking_delta` → reasoning events).

### Modified Capabilities

- `ai-provider`: The `AIProvider` abstraction now supports a registry of named providers; `createProvider` becomes `resolveProvider(qualifiedModel, providers[])`. The `models.list` RPC aggregates across all providers. Tasks with unresolvable model move to `awaiting_user`.
- `model-selection`: Model IDs stored on tasks and workflow column configs are now fully-qualified (`providerId/modelId`). The model dropdown shows all models from all providers flat-sorted by provider then model name. Default model behavior changes: no default means `awaiting_user`.

## Impact

- `src/bun/config/index.ts`: `WorkspaceYaml` type changes; `AIProviderConfig` split into per-provider typed configs; auto-migration of old `ai:` block.
- `src/bun/ai/index.ts`: `createProvider()` replaced with `resolveProvider()` + `listAllModels()`.
- `src/bun/ai/anthropic.ts`: New file — `AnthropicProvider` class.
- `src/bun/handlers/tasks.ts`: `models.list` aggregates across providers; execution path resolves provider or sets task to `awaiting_user`.
- `src/bun/workflow/engine.ts`: Provider resolution replaces single-provider assumption.
- `config/workspace.yaml`: Example and default config updated to `providers:` format.
- No frontend changes needed for reasoning/thinking display.
- Tests: new integration tests for multi-provider resolution, Anthropic wire format, model list aggregation, and `awaiting_user` fallback.
