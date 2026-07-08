## Why

The Cursor worker can get stuck on a stale SDK-side active run after a crash or kill, causing the same conversation to fail with `Agent already has active run` on later turns. We need a recovery path that keeps the current agent identity, avoids new Cursor-specific persistence, and lets the next turn continue without manual intervention.

## What Changes

- Tighten Cursor worker recovery when `agent.send()` hits `AgentBusyError`: retry once with `force:true`, then fail the current execution cleanly if the run is still busy.
- Keep the deterministic agent id unchanged; do not add Cursor-specific database fields or rotation state.
- Keep stale-run recovery local to the Cursor worker boundary so the Bun engine and orchestrator stay decoupled from Cursor SDK internals.
- Add structured internal logging for recovery attempts and outcomes, without changing user-visible conversation flow.
- Preserve the existing same-agent resume path for both task-linked conversations and detached chat sessions.

## Capabilities

### New Capabilities
- None.

### Modified Capabilities
- `cursor-sdk`: refine `AgentBusyError` recovery so persistent busy state after `force:true` fails the current execution cleanly while preserving the same deterministic agent id for future turns.

## Impact

Affected code: `src/bun/engine/cursor/worker.mjs`, `src/bun/engine/cursor/worker-client.ts`, and the existing Cursor engine spec/tests. No API or schema changes are required.

Testing scope stays backend-only: unit coverage for busy retry/failure handling, plus in-memory DB integration coverage for task happy path, chat happy path, persistent-busy failure, and worker crash respawn. No new Playwright scenario is needed because the UI contract remains silent.
