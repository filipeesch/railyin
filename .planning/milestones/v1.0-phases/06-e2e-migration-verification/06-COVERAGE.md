# COVERAGE.md — API Coverage Decision Record

**Phase:** 6 — E2E Migration & Verification
**Detector run:** `node <gsd-core>/bin/lib/api-coverage.cjs --json .planning/phases/06-e2e-migration-verification/06-RESEARCH.md .planning/phases/06-e2e-migration-verification/06-CONTEXT.md` → `{"detected":false,"signals":[],"terms":{"verbs":["integrate","integrates","integrating","integration","wrap","wraps","wrapping","connect","connects","connecting","consume","consumes","consuming","wire","wires","wiring","onboard","onboarding","adopt","adopts","adopting"],"nouns":["api","apis","sdk","sdks","rest","graphql","grpc","endpoint","endpoints","oauth","oauth2","webhook","webhooks","mcp"]}}`

> The detector did NOT fire: zero integration signals (no external API verb/noun pairs) across
> both source artifacts. This record still closes the gate explicitly, documenting the
> reasoning behind the declaration.

## Decision

**No external API integration: the phase is a pure test-suite migration onto the existing in-process mock fixture foundation. It adds zero packages, zero API keys, zero external hosts — all UI traffic is mocked in `page.route()` (ApiMock 501-loud + MockAgui under `/api/copilotkit/*`), and `e2e/api` remains the single real-server layer (the wire-format truth for the mocks). No API coverage matrix required.**

In full: Phase 6 consumes the pinned stack from Phases 1-5 — `@playwright/test@1.59.1`, `@ag-ui/*@0.0.57`, `@copilotkit/vue@1.66.4`, `bun test` (vitest) — with zero additions (RESEARCH §Package Legitimacy Audit: "No packages to install. This phase adds zero dependencies"). Every migrated spec runs against `dist/` served by `vite preview` with `/api/**` intercepted via `page.route`; the only code added is test/fixture code under `e2e/ui/`. The real Bun server is exercised only by `e2e/api` (backend smoke, 82 tests) — the phase's single real-server layer, already mounted and owned by prior phases.

## Rationale

| Signal the detector would look for | Status in this phase |
|------------------------------------|----------------------|
| Network API (REST/GraphQL/gRPC) consumed at runtime | None external — UI specs mock ALL `/api/**` via `page.route()` (ApiMock 501-loud, `route.fallback` contract); `e2e/api` talks only to the app's own loopback origin (Bun.serve) |
| Remote service credentials / env keys | None — no env vars introduced; Playwright's `CI` flag only changes retries/workers (playwright.config.ts:28-29) |
| Third-party HTTP endpoints called by app code | None — self-hosted runtime (HOST-01), local-first; every spec's `/api/copilotkit/*` traffic is the MockAgui fixture (EventEncoder-framed, byte-identical to the runtime per `sse-text-diff.test.ts`) |
| External API capability surface to enumerate (INTEGRATE/OPT-OUT) | N/A — the surface under test is the app's own CopilotKit route table + JSONL thread store, first-party deliverables from Phases 1-4, not integrations to decide on |

## Detector Signals Adjudicated

The detector emitted **no signals** (`detected: false`). The only "capability surface" in scope is the
already-mounted CopilotRuntime route table + the local JSONL thread store — both first-party
deliverables from Phases 1-4, not integrations to decide on. All AG-UI SSE traffic in UI specs is
fixture-mocked (D-04 discipline, AGENTS.md); the real-server layer stays exactly where it was:
`e2e/api` (82 pass, verified in the D-05 gate).

**Outcome:** Coverage matrix not required; this record closes the gate with the verbatim detector output and the reasoned declaration above.
