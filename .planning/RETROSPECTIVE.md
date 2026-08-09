# Retrospective

## Milestone: v1.0 — AG-UI/CopilotKit Chat Stack Rework

**Shipped:** 2026-08-09
**Phases:** 7 | **Plans:** 29 | **Tags:** v1.0

### What Was Built

- CopilotRuntime mounted inside the existing Bun.serve (fetch-native handler, `/api/copilotkit/*`, SSE round-trip proven, idle-timeout mitigation)
- `RailyinAgent` (AbstractAgent bridge) + `RailyinAgentRunner` (InMemoryAgentRunner subclass with JSONL persistence): all five engines behind one AG-UI boundary, replay, run locking, complete tool-call lifecycle
- Canonical AG-UI decision interrupts: `RUN_FINISHED` interrupt outcome + `RunAgentInput.resume[]`, with module-level registry, post-restart rebuild, and orphaned-row finalize
- Crash-tolerant JSONL store, `threads.list` RPC, idempotent legacy import over frozen tables (atomic tmp+rename marker)
- CopilotKit Vue chat UI (RailyinChat thin wrapper, 13 tool slots, DecisionInterrupt, ChatThreadSidebar, markdown parity, XSS-hardened with DOMPurify)
- Full E2E migration onto the mock foundation: 25-file red surface → zero; suite green at 518 pass / 0 fail
- Cleanup & feature trim: zero-write frozen tables, dead chat stack deleted, legacy import flag-retired, full D-07 gate green

### What Worked

- **Tracer-first planning with Wave-0 scaffold** — every phase led with a thin end-to-end slice verified before expansion; mock foundation built before the migrations that consumed it
- **Plan-checker caught real bugs pre-execution** — invalid `-x` flags (twice), the RPC-contract/task.ts consumer break in Phase 7, checkpoint ordering, ensureOpen wiring gaps — the revision loop earned its cost every time
- **Code review caught real defects** — stored XSS via v-html (CR-01, Phase 5), double RUN_STARTED (Phase 3), tool-seq id collisions (Phase 2), eventsource dual-package race (Phase 1) — the fix chain with worktree isolation was reliable
- **Canonical-contract discipline** — the all-canonical AG-UI interrupt decision (vs legacy on_interrupt) prevented a stranded-run failure mode
- **Grep-verified retirement** — every spec/component deletion was backed by zero-importer proofs before deletion

### What Was Inefficient

- **The `-x` flag regression recurred** — Phase 1's revision fixed it; Phases 2/3 regenerated it. Should be a planner-prompt invariant
- **eventsource dual-package race** — a Bun ecosystem bug that cost multiple full-suite debug cycles before the postinstall patch
- **Legacy spec migration scope underestimated** — CONTEXT said 10 expected-red specs; research found 25 files/301 tests (2.5x). The retire-vs-migrate triage was the corrective
- **Full-tree frontend suite broken** (pre-existing Pinia ref-unwrap) — never remediated; per-file runs masked it

### Patterns Established

- Worktree-isolated fixer agents with manifest-tracked merge-back (used for every review-fix chain)
- `bun test <file>` only — the `-x` flag does not exist on bun 1.4.0
- Mock foundation (mock-api + mock-agui) as the single source of truth for UI specs; 501-loud unhandled routes
- Frozen-table proofs in smoke tests (row-count assertions after runs)
- Flag-gated retired features (`RAILYN_LEGACY_IMPORT`, `RAILYN_COPILOTKIT_PROBE`)

### Key Lessons

1. **Research before planning pays** — the Phase 6 scope correction (25 vs 10 red files) and Phase 7's "the legacy write path IS the live engine" finding both came from researcher-verified inventories; CONTEXT assumptions were wrong twice
2. **Contract changes must enumerate consumers** — the Phase 7 RPC `{ executionId }` change broke live stores; the checker caught it because it measures, not assumes
3. **Ecosystem races (Bun dual-package) are real and intermittent** — a flaky suite is a product bug; chase it to root cause (postinstall patch) rather than test-side masking
4. **Blocking-human checkpoints on destructive ops** — the retire/decision gates made destructive work auditable without stalling auto mode (user pre-authorization)

### Cost Observations

- 29 plans across 7 phases executed end-to-end in one continuous autonomous run
- Every phase completed its own review-fix loop (7 review cycles, ~63 findings total, all fixed)
- Suite growth: 2268 backend tests (Phase 1) → 2255 after trim (Phase 7); Playwright 42 files / 518 tests green
