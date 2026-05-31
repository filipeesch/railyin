## Group 1: Repository layer

- [ ] 1.1 Create `src/bun/test/note-repository.test.ts` with a `describe('NoteRepository')` block
- [ ] 1.2 For each scenario NR-1..8: import `initDb` from `./helpers`, construct `NoteRepository(db)`, assert CRUD behavior
- [ ] 1.3 Verify `task_notes` schema is correctly created by `initDb()` (column names, FK, index)

## Group 2: Tool dispatch layer

- [ ] 2.1 Create `src/bun/test/note-tools.test.ts` with three `describe` blocks: `create_note`, `list_notes`, `update_note`
- [ ] 2.2 Build a minimal `CommonToolContext` using `initDb()` + `NoteRepository(db)` injected at `ctx.repos.notes`; use `buildCommonTools(executor)` pattern from `pi-common-tools-bridge.test.ts` for reference
- [ ] 2.3 For each scenario CNT-1..4: call `executeCommonTool("create_note", args, ctx)` and assert returned string
- [ ] 2.4 For each scenario LNT-1..4: seed notes directly via `NoteRepository(db)`, call `executeCommonTool("list_notes", {}, ctx)`, assert output
- [ ] 2.5 For each scenario UNT-1..4: seed a note, call `executeCommonTool("update_note", args, ctx)`, assert returned string and DB state

## Group 3: Structural and integration layer

- [ ] 3.1 In `src/bun/test/common-tools-registration.test.ts`, add a `describe('note tools')` block with scenarios CTR-N1..4 — assert name presence, parameter shapes, and `COMMON_TOOL_NAMES` membership
- [ ] 3.2 In `src/bun/test/pi-session-tools-integration.test.ts`, add `describe('buildToolAllowlist')` block with scenarios BTL-1..4 — import `buildToolAllowlist` from `../../engine/pi/constants`
- [ ] 3.3 In `src/bun/test/pi-session-tools-integration.test.ts`, add `describe('Pi SDK note tool allowlist')` block with scenarios IT-NOTE-1..3 — use existing faux provider setup, verify note tool names in session active tools and end-to-end persistence
