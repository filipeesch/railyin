# COVERAGE.md — API Coverage Decision Record

**Phase:** 3 — Decision Interrupts & Resume
**Detector run:** `api-coverage.cjs --json` over 03-RESEARCH.md + 03-CONTEXT.md + 03-03-PLAN.md → `{"detected":false,"signals":[]}`

## Decision

**No external API integration: the phase translates decision_request engine events into canonical AG-UI interrupt outcomes and consumes `RunAgentInput.resume[]` fully in-process via the already-installed npm SDK packages (`@ag-ui/core`, `@ag-ui/client`, `@copilotkit/runtime/v2`, `@copilotkit/vue`) — no network API is called, no remote service is contacted, no credentials are used, and the only HTTP surface is the app's own loopback origin serving the deliverable under test.**

## Rationale

The "SDK integration" the detector might flag is package-level, not API-level:

| Signal the detector would look for | Status in this phase |
|------------------------------------|----------------------|
| Network API (REST/GraphQL/gRPC) consumed at runtime | None — the decision cycle (interrupt terminal emission, pending-interrupt registry, resume translation/delivery, JSONL replay, post-restart lazy rebuild) is all in-process over `bun:sqlite` + local JSONL files (`data/threads/{threadId}.jsonl`); the resume path delivers through the existing `orchestrator.executeChatTurn` / `executeHumanTurn` chain — no external service |
| Remote service credentials / env keys | None — no API keys, no auth surface (zero package installs this phase; RESEARCH.md §Package Legitimacy Audit lists no `[ASSUMED]`/`[SUS]` names — no supply-chain checkpoint needed) |
| Third-party HTTP endpoints called by app code | None — `createCopilotRuntimeHandler` serves requests; the e2e clients (raw fetch, HttpAgent) target `http://127.0.0.1:{port}/api/copilotkit/*`, the app's own origin |
| External API capability surface to enumerate (INTEGRATE/OPT-OUT) | N/A — there is no third-party capability surface to opt into or out of |

The only "capability surface" is the CopilotRuntime's own route table (`/info`, `run`, `connect`, `stop`, `threads`) plus the local JSONL thread store — that is the *deliverable under test* (RUNR-08, CHAT-09, VERF-01, D-01..D-09), not an integration to decide on.

## UI-03 Coverage Split

**Phase 3 delivers the interrupt event + resume payload CONTRACT; the decision-card rendering lands in Phase 5** (per the 03-CONTEXT.md deferred list — "Vue interrupt slot rendering (`#interrupt` slot, useInterrupt, decision card port) — Phase 5").

- **This phase (event contract):** `buildInterruptOutcome` emits `RUN_FINISHED { outcome: { type: "interrupt", interrupts: [{ id, reason: "decision_request", message, metadata }] } }` where `metadata` carries the **parsed `DecisionRequestPayload`** — the Phase 5 card data (questions/options/context). Pinned by `event-bridge.test.ts` (buildInterruptOutcome describe block) and e2e test 11 (metadata assertions over the real wire).
- **This phase (payload contract):** the resume payload contract (`{ decision, answers?, generalNotes?, recordAsDecisions? }`) is documented at the single source of truth `translateResumeToSubmission` in `event-bridge.ts` — Phase 5's `useInterrupt` approve/reject handler must produce exactly this shape.
- **Phase 5 (rendering):** the `#interrupt` slot / `useInterrupt` card UI, powered by the metadata above. The REQUIREMENTS.md UI-03 checkbox closes at Phase 5; **this record is the traceability note** — Phase 3's UI-03 share is the contract, proven over the wire by e2e tests 11-17.

**Outcome:** Coverage matrix not required; this record closes the gate with the reasoned declaration above plus the UI-03 contract-vs-rendering split.
