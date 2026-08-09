# COVERAGE.md — API Coverage Decision Record

**Phase:** 4 — JSONL Persistence & Legacy Import
**Detector run:** `api-coverage.cjs --json` over 04-RESEARCH.md + 04-CONTEXT.md → `{"detected":true,"signals":[{"verb":"wires","noun":"api","snippet":"…*What goes wrong:** Phase 5 wires the client to `/api/copilotkit/threads` and sees zero threads despite…"},{"verb":"consume","noun":"endpoint","snippet":"…. Document for Phase 5: never consume the runtime endpoint for the list. (Discretion item — planner can note…"},{"verb":"consumes","noun":"endpoint","snippet":"…ex to the user through Railyin's own thread-index endpoint, and delivers the on-demand, idempotent legacy im…"}]}`

> The detector FIRED on three signals this phase. Each is adjudicated below as a
> first-party/internal reference, not an external integration — the decision
> paragraph is the reasoned human overrule (declaration wins, signals surfaced).

## Decision

**No external API integration: local file scans (node:fs) + frozen SQLite reads (bun:sqlite) + AG-UI events from pinned in-repo packages — no network API, no credentials, no remote service; only the app's own loopback origin.**

In full: the phase scans local JSONL files via `node:fs`, reads frozen SQLite tables via `bun:sqlite`, and emits AG-UI events consumed by the already-installed pinned packages (`@ag-ui/core@0.0.57`, `@copilotkit/runtime@1.66.4`) — no network API is called, no remote service is contacted, no credentials are used, and the only HTTP surface is the app's own loopback origin serving the deliverable under test.

## Rationale

The "SDK integration" the detector might flag is package-level, not API-level:

| Signal the detector would look for | Status in this phase |
|------------------------------------|----------------------|
| Network API (REST/GraphQL/gRPC) consumed at runtime | None — `threads.list` scans `data/threads/` via `readdirSync`/`statSync`; `legacyImport.run` reads frozen legacy tables through parameterized `bun:sqlite` SELECTs and writes JSONL via `writeFileSync`+`renameSync`; runner persistence appends with `appendFileSync` — all local filesystem, no external service |
| Remote service credentials / env keys | None — no API keys, no auth surface (zero package installs this phase; RESEARCH.md §Package Legitimacy Audit lists no `[ASSUMED]`/`[SUS]` names — no supply-chain checkpoint needed) |
| Third-party HTTP endpoints called by app code | None — `createCopilotRuntimeHandler` serves requests; the e2e clients (raw fetch) target `http://127.0.0.1:{port}/api/copilotkit/*`, the app's own origin |
| External API capability surface to enumerate (INTEGRATE/OPT-OUT) | N/A — there is no third-party capability surface to opt into or out of |

The only "capability surface" is the CopilotRuntime's own route table (`/info`, `run`, `connect`, `stop`, `threads`) plus the local JSONL thread store — that is the *deliverable under test* (CHAT-08, IMPR-01/02, D-01..D-08), not an integration to decide on.

## Detector Signals Adjudicated (fallible-detector overrule)

| Signal (verb + noun) | Snippet | Adjudication |
|----------------------|---------|--------------|
| `wires` + `api` | "Phase 5 wires the client to `/api/copilotkit/threads` and sees zero threads despite…" (RESEARCH Pitfall 3) | First-party route path — the app's own mounted CopilotRuntime origin, quoted to warn Phase 5 NOT to use it as the data source. No third-party surface. |
| `consume` + `endpoint` | "never consume the runtime endpoint for the list" (RESEARCH Pitfall 3) | Instructs Phase 5 to never consume the runtime's local `GET /threads` — a negation of an internal endpoint. No external API. |
| `consumes` + `endpoint` | "…Railyin's own thread-index endpoint…" (CONTEXT D-02: "Phase 5's thread-list UI consumes it") | Railyin's OWN endpoint — the phase's deliverable (D-01/D-02), not an external API. |

All three signals resolve to in-process, first-party references; none names a vendor, host, or third-party service.

**Outcome:** Coverage matrix not required; this record closes the gate with the reasoned declaration above, the verbatim detector output, and the signal-by-signal overrule.
