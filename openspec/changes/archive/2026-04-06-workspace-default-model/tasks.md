## 1. Config Type & Loader

- [x] 1.1 Add `default_model?: string` field to `WorkspaceYaml` interface in `src/bun/config/index.ts`
- [x] 1.2 Update `workspace.yaml.sample` to document `default_model` with a commented-out example

## 2. Column Transition Fallback

- [x] 2.1 In `engine.ts` `moveTaskToColumn()`, update the model-resolution block: if the column has no `model`, apply `workspace.default_model` (if set) to the task; leave unchanged if neither is configured
- [x] 2.2 Verify the existing column-model-wins behaviour is preserved (column `model` still takes full precedence)

## 3. Task Creation Fallback

- [x] 3.1 In `create_task` handler (`src/bun/workflow/tools.ts`), when `args.model` is absent, fall back to `getConfig().workspace.default_model` when inserting the new task row

## 4. Tests

- [x] 4.1 Add unit/integration test: task created without explicit model inherits workspace `default_model`
- [x] 4.2 Add unit/integration test: task entering a column with no `model` gets workspace `default_model`
- [x] 4.3 Add unit/integration test: column `model` overrides workspace `default_model` on column transition
- [x] 4.4 Add unit/integration test: no workspace `default_model` → task model unchanged on column transition
