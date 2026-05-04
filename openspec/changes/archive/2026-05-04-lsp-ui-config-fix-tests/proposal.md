## Why

The `lsp-ui-config-fix` change introduces significant new behavior across the LSP subsystem (workspace-scoped config, stale-path detection, engine propagation, UI flows) but ships with zero automated test coverage for any of it. Two pre-existing bugs in `LspSetupPrompt` and `SetupView` were also discovered during exploration — both were completely undetected because no tests existed. This change adds the full test suite: unit, integration (in-memory DB), and Playwright UI tests.

## What Changes

- `src/bun/test/lsp.test.ts` — new `describe("TaskLSPRegistry", ...)` block covering stale-path detection and all getManager/releaseTask scenarios
- `src/bun/test/lsp.test.ts` — new `describe("lspHandlers", ...)` block covering workspace isolation for `addToConfig`, `runInstall`, and `workspaceSymbol` fallback behavior (uses injected fake registry + fake installer via DI seams)
- `src/bun/test/execution-params-builder.test.ts` — new cases for `workspaceKey` propagation in `build()` and `buildForChat()`
- `src/bun/test/orchestrator.test.ts` — new case asserting `ExecutionParams.workspaceKey` matches the board's workspace key
- `src/bun/test/helpers.ts` — `setupTestConfig()` extended with `extraWorkspaces` parameter (part of `lsp-ui-config-fix` but consumed here)
- `e2e/ui/workspace-settings.spec.ts` — new suite `L` covering "Configure LSP" button per project row, language detection flow, LspSetupPrompt shown/hidden, and `workspaceKey` forwarded in RPC calls
- `e2e/ui/workspace-settings.spec.ts` — new suite `LP` covering `dismissOnly` navigation behavior

## Capabilities

### New Capabilities

- `lsp-workspace-config-tests`: Test coverage for the `lsp-workspace-config` capability introduced by `lsp-ui-config-fix`

### Modified Capabilities

- `project-management`: Delta spec for the "Configure LSP" project row action gains test scenarios

## Impact

- `src/bun/test/lsp.test.ts` — extended with ~30 new test cases
- `src/bun/test/execution-params-builder.test.ts` — extended with 2 new cases
- `src/bun/test/orchestrator.test.ts` — extended with 1 new case
- `e2e/ui/workspace-settings.spec.ts` — extended with ~10 new Playwright cases
- Depends on DI seams added in `lsp-ui-config-fix` (tasks 7.1–7.3)
