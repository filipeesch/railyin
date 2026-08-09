---
status: passed
phase: 1-copilotruntime-hosting-thread-apis-spike
source: [01-VERIFICATION.md]
started: 2026-08-09
updated: 2026-08-09
---

# Phase 1 — UAT

## Current Test

number: 1
name: Dev boot smoke — `bun run dev` serves /api/copilotkit/* single-origin
expected: |
  Run `bun run dev --port=3001`, confirm no second listener appears, and open
  http://127.0.0.1:3001/api/copilotkit/info in a browser. Expected: single
  Bun.serve process (no extra listener); /api/copilotkit/info returns JSON
  advertising agents.default and mode "sse" (or agents:{} with the probe flag unset).
awaiting: user response

## Tests

### 1. Dev boot smoke — `bun run dev` serves /api/copilotkit/* single-origin

expected: Run `bun run dev --port=3001`, confirm no second listener appears, and open http://127.0.0.1:3001/api/copilotkit/info in a browser. Expected: single Bun.serve process (no extra listener); /api/copilotkit/info returns JSON advertising agents.default and mode "sse" (or agents:{} with the probe flag unset).
result: [passed]

## Summary

total: 1
passed: 1
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps
