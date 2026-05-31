## 1. Frontend: Workspace switch reloads chat sessions

- [ ] 1.1 Import `useChatStore` in workspace store and call `loadSessions(key)` on workspace change
- [ ] 1.2 Close active session (`closeSession()`) when switching workspaces to prevent orphans
- [ ] 1.3 Remove duplicate `chatStore.loadSessions(...)` call from `App.vue` onMounted (now handled by workspace store)

## 2. Backend: Normalize chat session handlers

- [ ] 2.1 Replace raw SQL query in `chatSessions.get` with `fetchChatSessionWithModel(db, sessionId)`
- [ ] 2.2 Replace raw SQL query in `chatSessions.getMessages` with `fetchChatSessionWithModel(db, sessionId)`
- [ ] 2.3 Replace raw SQL query in `chatSessions.cancel` with `fetchChatSessionWithModel(db, sessionId)`
- [ ] 2.4 Extract `resolveWorkspaceKey(params: { workspaceKey?: string }): string` utility from repeated pattern
