# COVERAGE.md — API Coverage Decision Record

**Phase:** 5 — Chat UI Replacement (Vue)
**Detector run:** `api-coverage.cjs --json .planning/phases/05-chat-ui-replacement-vue/05-RESEARCH.md .planning/phases/05-chat-ui-replacement-vue/05-CONTEXT.md` → `{"detected":false,"signals":[]}`

> The detector did NOT fire: zero integration signals (no external API verb/noun pairs) across
> both source artifacts. This record still closes the gate explicitly, documenting the
> reasoning and the one in-process "SDK surface" that a naive reading might flag.

## Decision

**No external API integration: the CopilotKit Vue SDK is an in-process, already-installed, already-human-vetted client library talking only to the app's own loopback origin (`/api/copilotkit`). No network API, no remote service, no credentials — no API coverage matrix required.**

In full: Phase 5 consumes `@copilotkit/vue@1.66.4` (pinned exact since Phase 1, human-vetted install gate HOST-03/D-09) as a bundled in-process SDK. Its only HTTP surface is `runtime-url="/api/copilotkit"` — the app's own Bun.serve origin mounting the CopilotRuntime (Phases 1-4). The phase adds zero packages (RESEARCH §Package Legitimacy Audit: no `[ASSUMED]`/`[SUS]` additions; existing `[SUS]` flags already mitigated by Phase 1's human vetting + `e2e/api/copilotkit/pins.test.ts`), zero API keys, zero external hosts.

## Rationale

| Signal the detector would look for | Status in this phase |
|------------------------------------|----------------------|
| Network API (REST/GraphQL/gRPC) consumed at runtime | None external — the client talks only to `POST/GET /api/copilotkit/*` (run/connect/stop/info) on the app's own origin; the only other RPC surface is the existing in-app `api()` RailynAPI channel |
| Remote service credentials / env keys | None — `CopilotKitProvider` takes NO `publicApiKey`/`licenseToken` (verified provider props, RESEARCH.md); no secrets introduced |
| Third-party HTTP endpoints called by app code | None — self-hosted runtime (HOST-01), local-first |
| External API capability surface to enumerate (INTEGRATE/OPT-OUT) | N/A — the CopilotKit Vue API surface (CopilotChat props/slots, useInterrupt, useDefaultRenderTool) is a package API, not a network service; it is enumerated inside the phase docs (RESEARCH.md Patterns 1-5) for the wrapper's benefit, not for an API-coverage decision |

## Detector Signals Adjudicated

The detector emitted **no signals** (`detected: false`). The only "capability surface" in scope is the
already-mounted CopilotRuntime route table + the local JSONL thread store — both first-party
deliverables from Phases 1-4, not integrations to decide on.

**Outcome:** Coverage matrix not required; this record closes the gate with the verbatim detector output and the reasoned declaration above.
