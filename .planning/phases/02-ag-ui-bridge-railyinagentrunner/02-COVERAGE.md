# COVERAGE.md — API Coverage Decision Record

**Phase:** 2 — AG-UI Bridge & RailyinAgentRunner
**Detector run:** `api-coverage.cjs --json` over 02-RESEARCH.md + 02-CONTEXT.md + 02-03-PLAN.md → `{"detected":false,"signals":[]}`

## Decision

**No external API integration: the phase integrates in-process npm SDK packages (`@ag-ui/core`, `@ag-ui/client`, `@ag-ui/encoder`, `@copilotkit/runtime`, `@copilotkit/vue`, `rxjs`) that run inside Bun.serve — no network API is called, no remote service is contacted, and the only HTTP surface is the server's own loopback origin serving the deliverable under test.**

## Rationale

The "SDK integration" the detector might flag is package-level, not API-level:

| Signal the detector would look for | Status in this phase |
|------------------------------------|----------------------|
| Network API (REST/GraphQL/gRPC) consumed at runtime | None — RailyinAgent + RailyinAgentRunner + JsonlStore need no external services; JSONL persistence is local filesystem only (`data/threads/{threadId}.jsonl`) |
| Remote service credentials / env keys | None — no API keys, no auth surface (the phase's only install is the rxjs direct pin, audited OK/Approved — RESEARCH.md §Package Legitimacy Audit) |
| Third-party HTTP endpoints called by app code | None — `createCopilotRuntimeHandler` serves requests; the e2e clients (raw fetch, HttpAgent) target `http://127.0.0.1:{port}/api/copilotkit/*`, the app's own origin |
| External API capability surface to enumerate (INTEGRATE/OPT-OUT) | N/A — there is no third-party capability surface to opt into or out of |

The only "capability surface" is the CopilotRuntime's own route table (`/info`, `run`, `connect`, `stop`, `threads`) plus the local JSONL thread store — that is the *deliverable under test* (BRDG-01..03, RUNR-01..07), not an integration to decide on. Version pins (D-09) and the fetch-native handler choice (D-01) are locked user decisions implemented per plan; the rxjs direct pin (02-03 Task 2) makes the already-hoisted Observable dependency explicit per research Installation.

**Outcome:** Coverage matrix not required; this record closes the gate with the reasoned declaration above.
