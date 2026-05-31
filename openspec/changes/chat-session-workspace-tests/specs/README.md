# Test Coverage Specification

This directory intentionally contains no spec files. The `chat-session-workspace-tests` change adds automated test coverage for the workspace-scoping behavior defined in the companion feature change (`workspace-scoped-chat-sessions`).

Test coverage maps directly to the requirements specified in:
- `openspec/changes/workspace-scoped-chat-sessions/specs/chat-session/spec.md`

Each spec scenario in that file corresponds to at least one test across the three layers:

| Spec Requirement | Unit Test | Integration Test | Playwright E2E |
|------------------|-----------|------------------|----------------|
| Workspace-level sessions | WS-W-1 through WS-W-5 | CS-M-1 through CS-M-6 | CS-H-1 through CS-H-7 |
| Session list reload on switch | — | — | CS-H-3, CS-H-7 |
| Active session closed on switch | WS-W-2 | — | CS-H-2 |
| Multi-workspace isolation | — | CS-M-1 through CS-M-6 | CS-H-1, CS-H-3 |
| New session uses correct workspace key | WS-W-3 | CS-M-2 | CS-H-4 |
