## Context

The Cursor engine runs the `@cursor/sdk` in a Node subprocess because the SDK depends on Node HTTP/2 behavior. The worker currently retries `AgentBusyError` once with `force:true`, which is enough for transient cancel races but not for stale persisted runs left behind after a crash or hard kill. The result is a persistent `already has active run` failure mode for the same deterministic agent id across later turns.

The design must stay aligned with the existing architecture: Bun owns orchestration and execution state, the worker owns SDK process semantics, and the Cursor agent id remains deterministic per conversation. The user explicitly wants no Cursor-specific database fields and no agent-id rotation.

## Goals / Non-Goals

**Goals:**
- Recover from stale Cursor active-run state without manual kill/restart.
- Keep the same deterministic agent id for future turns.
- Keep stale-run handling inside the worker boundary, not in the orchestrator.
- Preserve silent user flow while adding structured internal diagnostics.
- Apply the behavior consistently to task-linked and detached chat conversations.

**Non-Goals:**
- Adding Cursor-specific schema columns or persistent recovery state.
- Rotating agent ids after failure.
- Moving recovery policy into `CursorEngine` or `StreamProcessor`.
- Changing unrelated Cursor dialect, prompt resolution, or tool-routing behavior.

## Decisions

### 1. Keep recovery worker-local
Persistent busy state originates inside the SDK runtime, so the worker should own recovery policy. `worker.mjs` (or a very small helper extracted beside it) is the right boundary because it already owns `Agent.resume`, `Agent.create`, `agent.send`, `run.cancel`, and `agent.close`.

**Alternatives considered**
- **Worker-client orchestrated recovery**: rejected because the client only sees serialized IPC errors and would start coupling transport code to SDK semantics.
- **Engine-level recovery**: rejected because it leaks Cursor-specific behavior into the engine abstraction and makes `CursorEngine` a god object.

### 2. Keep `resumeOrCreateAgent()` strict; recover at send-time
`resumeOrCreateAgent()` should stay focused on a single responsibility: resume if possible, otherwise create with the same deterministic agent id. Stale-run recovery belongs to `sendWithBusyRetry()` and a small recovery helper around it, because the failure happens when the SDK tries to start a new run, not when it resumes the agent object.

**Alternatives considered**
- **Broaden resume recovery**: rejected because it blends two different failure classes and makes it harder to distinguish local store corruption from a stale active run.

### 3. Retry exactly once with `force:true`, then fail the current execution cleanly
The first busy error should remain the existing transient-race recovery path. If `force:true` still reports busy, the worker should treat it as a persistent stale-run failure for this turn, emit a fatal run failure, and finalize the worker state so the next turn can start fresh with the same id. This avoids infinite loops and keeps the incident contained.

**Alternatives considered**
- **Keep retrying in the same turn**: rejected because it increases latency and adds a brittle retry state machine.
- **Silent user fallback prompt**: rejected because it adds noise and shifts recovery burden to users.

### 4. Do not persist recovery identity in the database
The deterministic agent id already gives stable conversation identity. The user explicitly does not want Cursor-specific database fields, so the fix should not add an override column or generation counter. Cleanup should rely on worker lifecycle and SDK close/cancel behavior rather than persisted recovery metadata.

**Alternatives considered**
- **Persist a rotated agent id**: rejected by user constraint and because it would spread Cursor-specific state into the schema.

### 5. Use structured logs, not user-visible recovery messages
Successful recovery should remain invisible in the conversation UI. The worker and adapter should emit structured logs that include execution/conversation identifiers, a short agent identifier, retry phase, and final outcome. This keeps debugging possible without exposing transport noise to the user.

## Risks / Trade-offs

- [Risk] A persistent busy agent may still fail the current turn even after `force:true` → [Mitigation] fail fast and preserve the same id so the next turn can recover without manual intervention.
- [Risk] Keeping the same agent id means SDK-internal state may remain partially stale → [Mitigation] close and finalize the worker run deterministically and avoid compounding retries.
- [Risk] Worker-local cleanup can drift into duplicated finalization code → [Mitigation] extract a small cleanup helper for run finalization and error normalization.
- [Risk] Logging can become noisy without structure → [Mitigation] standardize log fields and keep the user-facing stream unchanged.

## Migration Plan

No schema migration is required. The implementation can be deployed as a worker/client behavior change:

1. Add a small worker-local recovery helper around busy handling.
2. Keep `resumeOrCreateAgent()` unchanged in responsibility.
3. Normalize worker failure reporting so persistent busy states fail the current execution cleanly.
4. Preserve the same deterministic agent id for subsequent turns.
5. Roll back by reverting the worker/client changes; no data backfill is needed.

## Open Questions

None.
