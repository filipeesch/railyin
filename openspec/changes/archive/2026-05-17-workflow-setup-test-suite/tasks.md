## 1. Test fixtures and determinism

- [x] 1.1 Update `src/bun/test/helpers.ts` `setupTestConfig` to set `RAILYN_BUNDLED_WORKFLOWS_DIR` to a controlled fixture workflows directory and clear it in `cleanup`
- [x] 1.2 Update `e2e/api/fixtures/server.ts` `writeTestConfig`/`startServer` to set `RAILYN_BUNDLED_WORKFLOWS_DIR` for the spawned server
- [x] 1.3 Add a `workflow.list` baseline response to `e2e/ui/fixtures/index.ts` if non-workflow setup specs begin hitting it

## 2. Workflows module unit tests

- [x] 2.1 Create `src/bun/test/workflows.test.ts` covering `getBundledWorkflowsDir`, `listWorkflowFiles` (incl. skipping unparseable files), and `resolveWorkflowFilePath` (direct, by-id scan, not-found)
- [x] 2.2 Add `seedWorkflows` tests with an injected `sourceDir`: copy-all into empty target, skip-existing with content preserved, partial copy, non-YAML ignored, `.yml` handled
- [x] 2.3 Add `seedWorkflows` fallback tests: source missing + empty target, source empty + empty target, and source missing/empty + target already populated (no fallback written)
- [x] 2.4 Add `createWorkflowFile` tests: slug derivation, `-2`/`-3` collision suffixing, empty-slug `workflow` fallback, and minimal/valid output shape
- [x] 2.5 Add `evaluateDeletable` tests: free → deletable, referenced → not deletable, last → not deletable, both → referenced reason wins

## 3. Config-loader integration tests

- [x] 3.1 Add a config-loader test asserting no phantom `delivery` template is appended and every loaded workflow has a resolvable file
- [x] 3.2 Add a test asserting a fresh workspace is seeded with at least one workflow after `loadConfig`

## 4. Workflow handler tests

- [x] 4.1 Extend `src/bun/test/workflow-handlers.test.ts` for `workflow.list`: all workflows returned, `boardCount` accuracy, and `deletable`/`undeletableReason` for referenced, sole, and free workflows (boards created via `boardHandlers`)
- [x] 4.2 Add `workflow.create` tests: file written, id returned, appears in subsequent list, `notifyReloaded` spy invoked, collision suffix via the handler path
- [x] 4.3 Add `workflow.delete` tests: free workflow removed + `notifyReloaded` invoked, referenced rejected, last-remaining rejected, file untouched on rejection
- [x] 4.4 Add a `workflow.getYaml` regression test asserting it throws for an id with no backing file

## 5. e2e/api smoke tests

- [x] 5.1 Add `workflow.list`/`create` smoke tests against the spawned server (seeded workflow returned, create-then-list reflects the new workflow)
- [x] 5.2 Add `workflow.delete` guard smoke tests: rejected when referenced by a board, rejected for the last remaining workflow

## 6. Playwright UI suite

- [x] 6.1 Create `e2e/ui/workflow-setup.spec.ts` Suite WT (Workflows tab placed before Boards) and Suite W (rows show name + id, pencil + trash present)
- [x] 6.2 Add Suite WD: trash disabled for referenced and for last workflow, confirmed delete calls `workflow.delete`, cancel makes no call
- [x] 6.3 Add Suite WA: name-only Add dialog, submit disabled when empty, create + refresh + new row, new row pencil opens the editor
- [x] 6.4 Add Suite WE: pencil opens the overlay with the workflow name, Save calls `workflow.saveYaml` + refresh, Cancel/Escape dismiss without saving
- [x] 6.5 Add Suite WB (board header has no workflow pencil) and Suite WR (`workflow.reloaded` push refreshes the list)

## 7. Run and stabilize

- [x] 7.1 Run `bun test src/bun/test --timeout 20000` and `bun test e2e/api --timeout 30000`; fix failures
- [x] 7.2 Run `bun run build && npx playwright test e2e/ui/workflow-setup.spec.ts`; fix failures
