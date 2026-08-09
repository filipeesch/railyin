# Phase 1: CopilotRuntime Hosting & Thread APIs (Spike) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-08
**Phase:** 1-CopilotRuntime Hosting & Thread APIs (Spike)
**Areas discussed:** Runtime handler choice, Mount path & routing, SSE idle-timeout strategy, Spike probe agent, Mock fixture validation scope (auto mode — all auto-selected, recommended options chosen)

---

## Runtime Handler Choice

| Option | Description | Selected |
|--------|-------------|----------|
| Fetch-native `createCopilotRuntimeHandler` | From `@copilotkit/runtime/v2`; Bun/Deno/Workers-native, zero framework deps, same-origin | ✓ (recommended — evidence in STACK.md) |
| hono handler (`createCopilotHonoHandler`) | Only if already on hono or middleware needs grow; PROJECT.md's earlier assumption | |

**User's choice:** auto (recommended default) — fetch-native handler; supersedes PROJECT.md hono assumption; evidence recorded in spike output.
**Notes:** PROJECT.md's "hono handler" claim contradicted by research; D-01 records the correction; HOST-03 requires the decision recorded with evidence.

---

## Mount Path & Routing

| Option | Description | Selected |
|--------|-------------|----------|
| `/api/copilotkit/*` prefix | Multi-route default mode (run/connect/stop/info), coherent with `/api/*` RPC namespace | ✓ (recommended) |
| Root-level routes | Separate top-level namespace | |

**User's choice:** auto (recommended default) — `/api/copilotkit/*` in multi-route mode.

---

## SSE Idle-Timeout Strategy

| Option | Description | Selected |
|--------|-------------|----------|
| Verify + record working config | Bun.serve default idleTimeout 30s can kill SSE during agent silences; spike proves survival and documents config in PROJECT.md | ✓ (recommended) |
| Defer to later phase | Assume defaults fine | |

**User's choice:** auto (recommended default) — spike must verify HOST-02; record working idle-timeout configuration.
**Notes:** `RAILYN_STREAM_IDLE_TIMEOUT_MS` exists (`src/bun/ai/retry.ts:41`) — check interaction before adding new knobs.

---

## Spike Probe Agent

| Option | Description | Selected |
|--------|-------------|----------|
| Scripted/test agent (mock engine) | Deterministic EngineEvent streams, no API keys, no network | ✓ (recommended) |
| Real engine (pi/claude) | Real streaming but slow, needs keys, non-deterministic | |

**User's choice:** auto (recommended default) — probe with mock-engine pattern; real-engine bridging is Phase 2.

---

## Mock Fixture Validation Scope

| Option | Description | Selected |
|--------|-------------|----------|
| Validate fixtures against real server | Compare fixture-emitted AG-UI/SSE sequences to real runtime responses; become E2E foundation | ✓ (recommended — success criterion 5) |
| Write fixtures independently | Risk of divergence from real behavior | |

**User's choice:** auto (recommended default) — validate in-phase per success criterion 5.

---

## the agent's Discretion

- Fixture implementation shape within `mock-api.ts`/`mock-ws.ts` conventions.
- Keep-vs-fold probe code location (script vs `e2e/api/fixtures/`) — must not pollute production `src/bun/`.

## Deferred Ideas

- Own thread-index endpoint — Phase 4 (CHAT-08).
- Regenerate/retry API verification — Phase 5.
- hono handler — only if middleware needs grow.
