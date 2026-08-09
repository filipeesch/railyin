# Deferred Items — Phase 05 (Chat UI Replacement Vue)

Out-of-scope issues discovered during plan execution, logged per the GSD
executor scope boundary (do not auto-fix; log and continue).

## 1. Pre-existing: `bun test src/mainview` full-directory run fails (85 failures)

- **Found during:** 05-01 wave gate (`bun test src/mainview --timeout 20000`)
- **Symptom:** When running the FULL `src/mainview` directory, 85 tests fail
  across the Pinia store suites (task/chat/conversation/board/workspace +
  dispatch) with Pinia ref-unwrapping symptoms: `store.messages` evaluates to
  `{ value: [...] }` / `store.tasksByBoard` is `undefined` instead of the
  unwrapped state. The same files pass in isolation:
  `bun test src/mainview/stores/conversation.test.ts` → 26 pass / 0 fail;
  `bun test src/mainview/stores/` alone → 149 pass / 7 fail.
- **Root cause:** NOT this plan's changes. Reproduced byte-identical at the
  pre-plan commit `b0087c7a` (113 pass / 85 fail) with the same
  `node_modules`. A full-directory bun-test run artifact — the store tests
  interfere with each other's Pinia module state when bun runs the whole tree.
- **Plan impact:** 05-01's wave gate (`bun test src/mainview` stays green) is
  unprovable in this environment for the full tree; per-file runs are green.
  Wave gate evidence instead uses the unaffected suites + per-file store runs.
- **Fix owner:** A future plan (likely Phase 5 cleanup / test-infra plan, or
  before `gsd-ship`) — investigate bun test worker isolation for Pinia
  stores (e.g., `pool: forks` in vitest config, or per-file module registry).
- **Status:** open
