## 1. Unit Tests — Workspace → Chat Store Interaction

- [ ] 1.1 Create `src/mainview/stores/workspace-chat.test.ts` with Pinia setup and chatStore mock via vi.mock()
- [ ] 1.2 Implement WS-W-1: loadSessions(wsKey) called with new key on workspace switch
- [ ] 1.3 Implement WS-W-2: closeSession() called when switching to different workspace (orphan cleanup)
- [ ] 1.4 Implement WS-W-3: loadSessions still called when switching to same workspace (refresh)
- [ ] 1.5 Implement WS-W-4: no API call when workspace key is null/undefined
- [ ] 1.6 Implement WS-W-5: loadSessions failure does not break workspace config loading

## 2. Integration Tests — Multi-Workspace Isolation

- [ ] 2.1 Append CS-M test suite to existing handlers.test.ts
- [ ] 2.2 Implement CS-M-1: session created in ws-A does NOT appear in ws-B list
- [ ] 2.3 Implement CS-M-2: session created in ws-B does NOT leak to ws-A
- [ ] 2.4 Implement CS-M-3: rename preserves workspace association
- [ ] 2.5 Implement CS-M-4: archive preserves workspace isolation across workspaces
- [ ] 2.6 Implement CS-M-5: normalized get handler returns same data as raw query (post-refactor)
- [ ] 2.7 Implement CS-M-6: concurrent multi-workspace session creation order preserved

## 3. Playwright E2E — Chat Workspace Scoping

- [ ] 3.1 Create new file `e2e/ui/chat-workspace-scoping.spec.ts` with Suite CS-H structure
- [ ] 3.2 Implement CS-H-1: sessions from wsA hidden when viewing wsB (localStorage-seeded state)
- [ ] 3.3 Implement CS-H-2: active session closed on workspace switch (drawer closes, no active item)
- [ ] 3.4 Implement CS-H-3: sidebar reloaded after switch shows new workspace sessions (WS push)
- [ ] 3.5 Implement CS-H-4: creating session in ws-2 sets correct workspaceKey (API capture)
- [ ] 3.6 Implement CS-H-5: archived sessions from other workspace don't leak
- [ ] 3.7 Implement CS-H-6: selecting session from wsB works correctly (get + messages)
- [ ] 3.8 Implement CS-H-7: switching back to original workspace restores sessions
