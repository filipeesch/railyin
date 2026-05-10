---
id: 2026-05-09-remove-workspace-engine-block-tests
title: Test suite for engine-config breaking change
type: proposal
status: draft
created: 2026-05-09
companion: 2026-05-09-remove-workspace-engine-block
---

## What

A companion test change covering all unit, integration, and Playwright tests required to validate the `remove-workspace-engine-block` breaking change. Tests are kept in a separate proposal to isolate implementation artifacts from test artifacts and allow parallel review.

## Why

The parent change deletes `LoadedConfig.engine`, makes `engines.yaml` mandatory, and replaces the `engine:` block with `default_model:` in `workspace.yaml`. Every existing test that sets up config via the `engine:` block or asserts on `config.engine.*` will break. Additionally, the exploration pass identified new error paths (missing/present `engine:` block, missing `engines.yaml`) and a JOIN fix in `chat-sessions.ts` that require net-new test coverage.

The decision to separate the proposals was made to:
- Keep implementation tasks reviewable without noise from test case enumeration
- Allow the test suite to be reviewed against the spec independently

## Scope

### Files affected

**Modified test files:**
- `src/bun/test/engines-config.test.ts` — delete 3 fallback cases, reframe EC-4, add 4 error-path tests
- `src/bun/test/workspace-handlers.test.ts` — update fixture and handler assertions
- `src/bun/test/handlers.test.ts` — collapse 21 identical TC-1 test bodies to 1
- `src/bun/test/opencode-config.test.ts` — full rewrite of all 4 tests to use `engines.yaml`
- `src/bun/test/engine-registry.test.ts` — mechanical: remove `engine:` from `makeConfig` mock
- `src/bun/test/multi-engine-execution.test.ts` — mechanical: same `makeConfig` cleanup
- `src/bun/test/helpers.ts` — rename param, emit `default_model:`, always write default `engines.yaml`
- `e2e/ui/fixtures/mock-data.ts` — replace `engine: { model }` with `defaultModel:`
- `e2e/ui/workspace-settings.spec.ts` — add W-6/W-7/W-8 covering `defaultModel` save/load

**New test files:**
- (none — all new cases go into existing files)

## Out of scope

- Implementation changes to production code (owned by the companion change)
- Changes to the `enabled_models` DB table or `models.*` handlers
- End-to-end testing against a live Bun server (API smoke tests cover that separately)
