# Deferred Items — Phase 1 (CopilotRuntime Hosting & Thread APIs Spike)

Out-of-scope discoveries logged during plan 01-03 (not fixed — not caused by this plan's changes).

| Item | Found During | Description | Status |
|------|-------------|-------------|--------|
| e2e/tsconfig.json baseline type errors | 01-03 Task 1 verification | `bunx tsc --noEmit -p e2e/tsconfig.json` reports **95 pre-existing errors** in unrelated Playwright specs (autocomplete.spec.ts, board.spec.ts, chat-session-drawer.spec.ts, …) — pre-existing baseline (e2e not covered by root `bun run typecheck`; `"types": []` in e2e/tsconfig strips Playwright/bun types). Zero errors in copilotkit/mock-agui files. Fixing is out of scope for the spike; revisit when Phase 6 reworks the UI suite. | Open |
