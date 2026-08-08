# COVERAGE.md — API Coverage Decision Record

**Phase:** 1 — CopilotRuntime Hosting & Thread APIs (Spike)
**Detector run:** `api-coverage.cjs --json` over 01-RESEARCH.md + 01-CONTEXT.md → `{"detected":false,"signals":[]}`

## Decision

**No external API integration: the phase integrates five local npm SDK packages (`@ag-ui/core`, `@ag-ui/client`, `@ag-ui/encoder`, `@copilotkit/runtime`, `@copilotkit/vue`) that run in-process inside Bun.serve — no network API is called, no remote service is contacted, and the only HTTP surface is the server's own loopback origin.**

## Rationale

The "SDK integration" the detector might flag is package-level, not API-level:

| Signal the detector would look for | Status in this phase |
|------------------------------------|----------------------|
| Network API (REST/GraphQL/gRPC) consumed at runtime | None — ScriptedAgent + InMemoryAgentRunner need no external services (RESEARCH.md A5, verified in dist source: no network code in the runtime path) |
| Remote service credentials / env keys | None — no API keys, no auth surface (RESEARCH.md §Security Domain V2: not applicable) |
| Third-party HTTP endpoints called by app code | None — `createCopilotRuntimeHandler` serves requests; the probe clients (raw fetch, HttpAgent) target `http://127.0.0.1:{port}/api/copilotkit/*`, the app's own origin |
| External API capability surface to enumerate (INTEGRATE/OPT-OUT) | N/A — there is no third-party capability surface to opt into or out of |

The only "capability surface" is the CopilotRuntime's own route table (`/info`, `run`, `connect`, `stop`, `threads`) — that is the *deliverable under test* (HOST-01/02), not an integration to decide on. Version pins (D-09) and the fetch-native handler choice (D-01) are already locked user decisions implemented per plan; the handler decision is recorded as evidence in PROJECT.md (HOST-03).

**Outcome:** Coverage matrix not required; this record closes the gate with the reasoned declaration above.
