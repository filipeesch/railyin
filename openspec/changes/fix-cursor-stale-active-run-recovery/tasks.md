## 1. Worker recovery policy

- [ ] 1.1 Extract a small worker-local recovery helper for stale Cursor active-run handling
- [ ] 1.2 Keep `resumeOrCreateAgent()` strict and route all stale-run recovery through send-time handling
- [ ] 1.3 Define the persistent-busy failure path so a second `AgentBusyError` ends the current execution cleanly

## 2. Worker/adapter cleanup and normalization

- [ ] 2.1 Normalize worker failure reporting so persistent busy failures surface a structured fatal detail
- [ ] 2.2 Consolidate worker finalization so run cancellation, agent close, and pending-tool cleanup happen through one path
- [ ] 2.3 Update the Bun adapter to preserve the same deterministic agent flow while logging recovery outcomes internally

## 3. Internal observability and refactor follow-through

- [ ] 3.1 Add structured recovery logs in worker and adapter paths with execution/conversation context
- [ ] 3.2 Keep the recovery behavior silent in the user conversation stream
- [ ] 3.3 Remove any now-redundant inline recovery comments or duplicated cleanup logic introduced by the refactor
