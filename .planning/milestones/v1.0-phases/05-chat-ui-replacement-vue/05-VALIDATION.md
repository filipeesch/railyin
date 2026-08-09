---
phase: 5
slug: chat-ui-replacement-vue
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-08-09
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (frontend unit) + Playwright (UI e2e against `dist/` via `vite preview`, mocks via `page.route()`) |
| **Config file** | `vitest.config.ts`, `playwright.config.ts` |
| **Quick run command** | `bun test src/mainview --timeout 20000` |
| **Full suite command** | `bun run build && bun run test:e2e:chat && bun run typecheck` (UI specs) + `bun test src/bun --timeout 20000` (backend regression) |
| **Estimated runtime** | ~3 minutes (build + targeted e2e) |

---

## Sampling Rate

- **After every task commit:** Run the frontend unit tests (`bun test src/mainview --timeout 20000`)
- **After every plan wave:** Build + targeted chat e2e (`bun run build && bun run test:e2e:chat`)
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~3 minutes

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 1 | UI-01, CHAT-01 | — | CopilotChat mount + streaming in board chat | Playwright | `bun run test:e2e:chat` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | CHAT-07 | — | History on reopen (connect replay) | Playwright | `bun run test:e2e:chat` | ❌ W0 | ⬜ pending |
| TBD | 02 | 2 | UI-02, CHAT-03 | — | Tool cards + domain renderers | Playwright | `bun run test:e2e:chat` | ❌ W0 | ⬜ pending |
| TBD | 02 | 2 | CHAT-04, CHAT-05 | — | Stop + Stopped label; reasoning | Playwright | `bun run test:e2e:chat` | ❌ W0 | ⬜ pending |
| TBD | 02 | 2 | CHAT-06 | — | Slash commands + prompt refs | Playwright | `bun run test:e2e:chat` | ❌ W0 | ⬜ pending |
| TBD | 03 | 3 | CHAT-02, UI-04, IMPR-03 | — | Markdown parity, /ws intact, old stack alive | Playwright + grep | `bun run test:e2e:chat` + grep | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `e2e/ui/fixtures/mock-agui.ts` extended: `/connect` + `/stop` routes + wired into `e2e/ui/fixtures/index.ts`
- [ ] Chat spec scaffolding (CopilotChat mount, streaming assertions)

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Markdown/code rendering visual parity with old editor | CHAT-02 | Visual fidelity (held-out backstop per UI-SPEC) | Compare rendered chat markdown/code against the legacy editor in browser |
| "Stopped" label placement | CHAT-04 | Visual (backstop per UI-SPEC) | Stop a run; confirm label appears in the right spot |

*Two held-out visual backstops per UI-SPEC; everything else automated.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 3min
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
