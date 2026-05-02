---
description: "UI test runner: build app and run Playwright board/UI tests"
---

You are running the Railyn UI test suite. Follow these steps in order, every time, without asking for confirmation.

---

## Step 1 — Build the app

```bash
bun run build
```

---

## Step 2 — Run the UI tests

```bash
npx playwright test e2e/ui/
```

Report the result clearly: **N pass, M fail**, and list any failures with their error messages.

To run a specific suite:
```bash
npx playwright test e2e/ui/board.spec.ts
npx playwright test e2e/ui/chat-sidebar.spec.ts
npx playwright test e2e/ui/chat-session-drawer.spec.ts
```

---

## If tests fail

1. Read the failure message and the failing test name.
2. Diagnose the root cause in the **implementation** code (in `src/mainview/` or `src/bun/`).
   Do NOT weaken test assertions to make tests pass.
3. Fix the implementation and re-run from Step 2.

---

## Test environment facts

- **Test runner**: Playwright — `npx playwright test e2e/ui/`
- **Backend**: fully mocked via `ApiMock` + `WsMock` fixtures in `e2e/ui/fixtures/`
- **No server needed**: `vite preview` is started automatically by the Playwright `webServer` config
- **Build required**: tests run against `dist/` — always `bun run build` before testing
