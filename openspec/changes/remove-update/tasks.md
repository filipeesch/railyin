## 1. Remove `resetStuckTasks` from bootstrap

- [ ] 1.1 Delete the `resetStuckTasks()` function body (lines 118–131) from `src/bun/index.ts`
- [ ] 1.2 Delete the comment on line 117 (`// 3. Reset any tasks...`) and the blank line after it
- [ ] 1.3 Delete the `resetStuckTasks();` call on line 132

## 2. Update OpenSpec workflow-engine spec

- [ ] 2.1 Verify delta spec in `openspec/changes/remove-update/specs/workflow-engine/spec.md` correctly removes the "Stale running state reset on startup" requirement
- [ ] 2.2 Confirm the original spec at `openspec/specs/workflow-engine/spec.md` still contains the requirement (delta spec handles the removal at archive time)

## 3. Verify no remaining references

- [ ] 3.1 Grep for `resetStuckTasks` — only archived references expected (already confirmed zero active references)
- [ ] 3.2 Grep for the exact log message `[db] Resetting` — only the deleted line remains (to be removed by 1.1)

## 4. Final review

- [ ] 4.1 Ensure `src/bun/index.ts` compiles without errors after removal
- [ ] 4.2 Review `openspec/changes/remove-update/` directory for completeness: proposal.md, design.md, specs/workflow-engine/spec.md, tasks.md
