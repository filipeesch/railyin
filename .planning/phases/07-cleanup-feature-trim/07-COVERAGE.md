# Phase 7 — API Coverage Decision Record

**Created:** 2026-08-09 (plan 07-05 close-out)
**Precedent:** 06-COVERAGE.md (Phase 6 API-coverage decision)

## Detector Output (verbatim)

Re-run at phase close-out:

```bash
node "$HOME/.config/opencode/gsd-core/bin/lib/api-coverage.cjs" --json 07-RESEARCH.md 07-CONTEXT.md
```

```json
{"detected":false,"signals":[],"terms":{"verbs":["integrate","integrates","integrating","integration","wrap","wraps","wrapping","connect","connects","connecting","consume","consumes","consuming","wire","wires","wiring","onboard","onboarding","adopt","adopts","adopting"],"nouns":["api","apis","sdk","sdks","rest","graphql","grpc","endpoint","endpoints","oauth","oauth2","webhook","webhooks","mcp"]}}
```

Identical to the planning-time run — `{"detected":false,"signals":[]}`.

## Declaration

**No external API integration.** Phase 7 is a pure-deletion phase:

- **Zero packages** added or removed (no `npm install`/`bun add` anywhere in the phase; the plan explicitly forbade package operations — the only supply-chain surface is the existing pinned toolchain)
- **Zero API keys** introduced or consumed (new env var `RAILYN_LEGACY_IMPORT` is a local behavior gate, not a credential)
- **Zero external hosts** contacted by production code (single-process local app; `localhost` only)
- **All UI traffic mocked** via `page.route()` (the `api` fixture ApiMock + `agui` MockAgui against `/api/copilotkit/*`)
- **`e2e/api` is the single real-server layer** — real `Bun.serve` spawns with `bun src/bun/index.ts`, covering the RPC + AG-UI wire contracts (incl. the flagged legacy-import suite, 07-05)

Per the 06 precedent, a coverage matrix is not required — the reasoned declaration closes the gate.

## Assumption-Delta Log (07-RESEARCH assumptions A1–A5)

| # | Assumption | Verdict | Resolution |
|---|-----------|---------|------------|
| A1 | The session-status replacement push (`notifyChatSessionUpdated` on run end) is required to keep the sidebar status correct | **CONFIRMED** | 07-01 implemented `onSessionStatusChange` wired end-to-end (consume() done/error/decision paths → orchestrator → notifier). Verified by execution-seam tests 4/5 + smoke lifecycle; the sidebar flips running→idle via the `chatSession.updated` push with no stream event (07-03 CD-C-1b spec). |
| A2 | The App.vue "Execution failed" toast (stream.error) can be dropped | **DECIDED** | Blocking checkpoint 07-01 Task 3 → **option-a DROP**. `notifications.onError` is a no-op; RUN_ERROR in chat + board `execution_state='failed'` cover the failure UX. |
| A3 | opencode shell_approval trim = auto-approve via `shellState.shellAutoApprove`, never waitForResume | **DECIDED** | Blocking checkpoint 07-02 Task 2 → **option-a auto-approve** via `onPermissionAsked` reading `shellState.shellAutoApprove`; deterministic deny otherwise. No invisible hang; `tasks.setShellAutoApprove` RPCs retain per-run control. |
| A4 | The legacy-import flag channel is the `legacyImport.enabled` RPC (Pattern 4 recommendation) | **CONFIRMED** | 07-05 implemented it: unconditional `legacyImport.enabled` RPC + server-side `RAILYN_LEGACY_IMPORT=1` gate on `legacyImport.run` registration; ChatThreadSidebar hides the button when disabled (fail-closed fetch). Build-time env and 404-driven UI rejected. |
| A5 | `chatSessions.compact`/`tasks.compact` RPCs have zero live UI callers | **CONFIRMED** | 07-04 removed both entries + handlers with typecheck clean — no live caller broke. |

No assumption fired differently than planned. No deltas to resolve.

## Schema Gate

**NOT triggered.** Zero migrations this phase — the frozen-table constraint (D-04) held throughout:

```bash
git log --oneline -20 -- src/bun/db/migrations
# → no phase-7 commits; last migration work predates the phase
```

All five plans performed pure code deletion/trim; no migration file was created or modified.
