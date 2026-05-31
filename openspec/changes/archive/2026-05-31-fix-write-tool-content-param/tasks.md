## 1. Schema Changes (`patchFileParams`)

- [x] 1.1 Reorder `patchFileParams` properties to: `path`, `content`, `anchor`, `position`
- [x] 1.2 Update `content` field description to include explicit `REQUIRED` marker and clarify it is the text to insert or replace
- [x] 1.3 Update `anchor` field description to note it is ignored when `position` is `start` or `end`

## 2. Description Improvements

- [x] 2.1 Rewrite `write_file` tool description: add required-params list (`path`, `content`) and a concrete JSON example
- [x] 2.2 Rewrite `patch_file` tool description: add required-params list (`path`, `content`, `anchor`, `position`) and a concrete JSON example showing all four params

## 3. `prepareArguments` Hooks

- [x] 3.1 Add private `requireContent(toolName, rawArgs)` helper at the top of `write.ts` that throws a targeted error when `content` is absent or not a string
- [x] 3.2 Add `prepareArguments` to `writeFileTool` using `requireContent`
- [x] 3.3 Add `prepareArguments` to `patchFileTool` using `requireContent`

## 4. Verification

- [x] 4.1 Run `bun test src/bun/test --timeout 20000` and confirm all existing tests pass
