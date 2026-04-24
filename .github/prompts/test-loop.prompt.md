---
description: "TDD loop: write tests → run → fix bugs → add tests → optimize → cleanup → final run"
---

You are running a disciplined test-driven quality loop.

**The loop has these phases — execute them in order, repeat until done:**

---

## Phase 1 — Write / expand tests

Write all missing test cases identified in conversation or specs. Tests go in `e2e/ui/<feature>.spec.ts` using Playwright + the `ApiMock`/`WsMock` fixtures from `e2e/ui/fixtures/`.

Follow the existing suite structure (Suite A, B, C…). Each new suite gets the next letter. Tests must be self-contained — set up their own API mock state before `page.goto('/')`.

---

## Phase 2 — Build and run tests

```bash
bun run build
npx playwright test e2e/ui/
```

The backend is fully mocked — no server needed. `vite preview` is started automatically.

To run a focused subset:
```bash
npx playwright test e2e/ui/board.spec.ts
```

After running, clearly report: **N pass, M fail** and the name/message of each failure.

---

## Phase 3 — Fix bugs in the implementation

For each failing test, diagnose the root cause in the **implementation** code (not in the test assertions). Fix the implementation. Do not weaken test assertions to make tests pass.

---

## Phase 4 — Add missing tests (if new gaps found during Phase 3)

If fixing a bug reveals an untested scenario, add a test for it before re-running.

---

## Phase 5 — Repeat phases 2–4 until all tests pass

Keep iterating. Do not proceed to Phase 6 until the full suite is green.

---

## Phase 6 — Optimize and clean up the implementation

With all tests green, review the implementation for:
- Dead code paths / obsolete helpers
- Correctness issues that tests don't catch (e.g., race conditions, memory leaks, missing disposals)
- Simplifications that don't change behaviour

Make targeted improvements. Do not refactor things unrelated to the feature.

---

## Phase 7 — Run tests again after optimization

```bash
bun run build
npx playwright test e2e/ui/
```

All tests must still pass. If any fail, go back to Phase 3.

---

## Phase 8 — Final cleanup

- Remove any temporary `console.log` / debug logging added during diagnosis
- Verify no leftover `TODO` comments from this session

---

## Phase 9 — Commit

Once everything is green and clean:

```bash
git add -A && git commit -m "<concise description of what was fixed/added>"
```

---

**Rules:**
- Never weaken a test assertion to make it pass — fix the implementation instead
- Never skip or comment out a failing test — every test must pass or be explicitly removed with a reason
- After each phase, briefly report what was done and what is next
- If the loop has been running more than 3 full cycles without progress, stop and explain the blocker to the user
