---
phase: 01-copilotruntime-hosting-thread-apis-spike
reviewed: 2026-08-09T04:30:00Z
depth: standard
files_reviewed: 11
files_reviewed_list:
  - e2e/api/copilotkit/copilotkit.test.ts
  - e2e/api/copilotkit/pins.test.ts
  - e2e/api/copilotkit/probe-agent.ts
  - e2e/api/copilotkit/sse-text-diff.test.ts
  - e2e/api/fixtures/server.ts
  - e2e/ui/fixtures/mock-agui.ts
  - e2e/ui/fixtures/mock-api.ts
  - package.json
  - scripts/patch-eventsource.ts
  - scripts/postinstall.ts
  - src/bun/index.ts
findings:
  critical: 0
  warning: 1
  info: 6
  total: 7
status: clean
---

# Phase 1: Code Review Report

**Reviewed:** 2026-08-09T04:30:00Z
**Depth:** standard
**Files Reviewed:** 11
**Status:** issues_found

## Summary

Spike phase review of the CopilotRuntime mount (`src/bun/index.ts`), the ScriptedAgent probe (`e2e/api/copilotkit/probe-agent.ts`), the MockAgui fixture (`e2e/ui/fixtures/mock-agui.ts`), pin evidence, and the eventsource/postinstall patch.

The core spike deliverables are sound and well-verified: the mount ordering (copilotkit prefix before the RPC router), the `srv.timeout(req, 0)` idle-timeout override (proven by the >30s silence test), the env-gated probe agent behind `RAILYN_COPILOTKIT_PROBE`, the byte-identical SSE fixture (validated end-to-end), and the `route.fallback()` handoff in ApiMock (verified against playwright-core's `urlMatchesEqual` — exact string match, so `/api/copilotkit/**` survives ApiMock re-installs). The rxjs dual-copy interop casts are documented and empirically proven.

One **critical** defect was found: `scripts/patch-eventsource.ts` calls `process.exit(0)` on its skip paths, which terminates the *parent* `postinstall.ts` process and silently skips code-server's postinstall on every install after the first. One timing-sensitive test and six quality items round out the report. No security findings (ASVS L1): the app remains loopback-only and unauthenticated consistently; the probe env gate cannot be reached from `bun run prod`.

## Critical Issues

### CR-01: `process.exit(0)` in patch-eventsource.ts aborts the rest of postinstall.ts (code-server postinstall silently skipped)

**File:** `scripts/patch-eventsource.ts:7-17, 28-31`
**Issue:** `postinstall.ts` line 9 does `await import("./patch-eventsource.ts")`. The patch module calls `process.exit(0)` on **all three** skip paths:
- `eventsource` not installed (lines 8-9),
- version ≠ 3.0.7 (lines 14-17),
- **exports already patched (lines 28-31) — this is the common case.**

`process.exit()` terminates the entire Bun process, so the caller's remaining code — the code-server `postinstall.sh` step (`postinstall.ts:14-33`) — never runs. Consequence: on every `bun install` after the first (node_modules is already patched — verified: the installed `node_modules/eventsource/package.json` exports currently match the patched shape), code-server's postinstall is deterministically skipped. code-server's `postinstall.sh` creates the platform binary symlinks (`bin/code-server` → `bin/code-server-darwin.sh`, etc.); a reinstall of code-server without its postinstall leaves the launcher broken. The same silent skip occurs on fresh installs where eventsource isn't hoisted or resolves to a different version. The patch script's own log lines say "skipping" the *patch*, but the side effect is skipping the *parent script* — clearly unintended and not documented in 01-03-SUMMARY.

**Fix:** Never `process.exit()` from the imported module. Export a function and let `postinstall.ts` decide what to do:
```ts
// scripts/patch-eventsource.ts
export type PatchStatus = "patched" | "already-patched" | "skipped-not-installed" | "skipped-version";
export function patchEventsource(): PatchStatus {
  // ... existing checks, but return a status instead of process.exit(0);
  // writeFileSync + return "patched" in the success path
}

// scripts/postinstall.ts
const status = await patchEventsource();
console.log(`[postinstall] eventsource: ${status}`);
// ... code-server postinstall step runs unconditionally after this
```
If standalone execution of the patch script is ever needed, guard with `if (import.meta.main) process.exit(0)` so the exit only fires when run directly (`bun scripts/patch-eventsource.ts`), never when imported.

## Warnings

### WR-01: Stop test relies on a fixed 800ms sleep with no synchronization

**File:** `e2e/api/copilotkit/copilotkit.test.ts:83-92`
**Issue:** Test C fires the run request and then waits a hard-coded 800ms before POSTing `stop/t2`, asserting `stopBody.stopped === true`. If the run request is delayed (loaded CI machine, slow loopback) the stop may arrive before the runner has registered the run, making the assertion timing-dependent — either a spurious `stopped: false`/error or a masked no-op stop. The test is probe evidence, but it runs in the standard `e2e/api` suite where flakiness costs signal.
**Fix:** Synchronize on observable state instead of a fixed sleep — poll the run stream (or the thread events endpoint) until a `RUN_STARTED` frame is observed, then issue the stop; alternatively retry the stop until `{stopped: true}` is returned with a bounded deadline. Keep the 10s test timeout.

## Info

### IN-01: `srv.timeout(req, 0)` applies to every `/api/copilotkit/*` request, not just SSE streams

**File:** `src/bun/index.ts:348-351`
**Issue:** The per-request idle-timeout disable is applied before the runtime handler, so it covers `GET /info`, `GET /threads`, `POST stop`, and even 404 paths — any of which can now hold a connection open indefinitely if a client stalls. Local single-user app, so impact is minimal, but the override is only needed for the long-lived `run`/`connect` streams.
**Fix:** Scope the override to the SSE-producing routes (e.g., check `url.pathname.match(/\/agent\/[^/]+\/(run|connect)$/)` and method) before calling `srv.timeout(req, 0)`.

### IN-02: Runtime mount is unconditional in prod with an empty agents map

**File:** `src/bun/index.ts:269-277`
**Issue:** In `bun run prod` the runtime is mounted at `/api/copilotkit/*` with `agents: {}`. `POST /agent/default/run` returns a runtime "agent not found" error and `/info` advertises an empty agent map — a dead endpoint surface that exists only because the spike decided D-01 (mount always). Harmless locally, but a later phase that forgets the env gate would silently expose the probe agent; consider gating the mount itself (not just the agent map) behind the flag in Phase 4.

### IN-03: eventsource patch drops the `types` and `browser` export conditions

**File:** `scripts/patch-eventsource.ts:19-26`
**Issue:** The replacement `exports` map contains only `import`/`require`/`default`. The original exports also carried `types` (and `browser`/`bun`) conditions. TypeScript still resolves declarations via the top-level `"types": "./dist/index.d.ts"` fallback, and nothing imports eventsource from TS directly today, so no current breakage — but any future direct TS import under `moduleResolution: "bundler"` will lose declaration resolution, and a browser-bundled consumer would silently get CJS.
**Fix:** Add a `types` condition to the fixed exports (`"./dist/index.d.ts"`) and keep `browser` pointing at the ESM build if any frontend code ever touches the package.

### IN-04: Thread-list evidence test is order-coupled to test B

**File:** `e2e/api/copilotkit/copilotkit.test.ts:149-157`
**Issue:** Test 8 asserts `body.threads.some((t) => t.id === "t1")`, which only holds because test B (earlier in the file) ran a run on thread `t1`. Running this test in isolation (`--test-name-pattern`) or skipping test B makes test 8 fail for the wrong reason.
**Fix:** Create the thread inside test 8 itself (POST a quick run on its own thread id) instead of relying on test B's side effect.

### IN-05: Fixture `.runtime/` dirs are not gitignored and stderr accumulates unboundedly

**File:** `e2e/api/fixtures/server.ts:41-52, 185-193`
**Issue:** `runtimePath()` creates dirs under repo-root `.runtime/` (currently empty and untracked, so invisible to `git status`), but a hard-killed test run (SIGKILL, machine crash) leaves the seeded git repo + files as untracked noise at the repo root — `.gitignore` has no `.runtime` entry. Additionally, the background stderr reader appends to a module-level string for the server's entire lifetime with no bound. Test-only concerns, but cheap to fix.
**Fix:** Add `.runtime/` to `.gitignore`; optionally cap the stderr buffer (keep only the last N KB, or stop draining after startup).

### IN-06: MockAgui's catch-all masks non-schema errors as 400

**File:** `e2e/ui/fixtures/mock-agui.ts:106-109`
**Issue:** The `catch { }` around `buildQuickRunSseBody` mirrors the runtime's 400 for schema-invalid input, but it also swallows genuine fixture bugs (encoder failures, `buildQuickRunEvents` errors), which would then be reported as a client-facing 400 instead of a failing test. The 400-on-invalid-JSON branch (lines 92-96) already handles the documented case.
**Fix:** Distinguish schema errors (`RunAgentInputSchema` `ZodError`) from unexpected errors — rethrow the latter so the test fails loudly.

---

_Reviewed: 2026-08-09T04:30:00Z_
_Reviewer: the agent (gsd-code-reviewer)_
_Depth: standard_
