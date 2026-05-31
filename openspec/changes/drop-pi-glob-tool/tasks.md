## 1. Remove glob tool implementation

- [ ] 1.1 In `src/bun/engine/pi/tools/read.ts`, remove the `globParams` TypeBox schema and the `globTool` factory function
- [ ] 1.2 In `src/bun/engine/pi/tools/read.ts`, update `buildReadTools` to return an empty array `[]` (keep `safePath` export — used by write/undo tools)

## 2. Remove glob from tool registration

- [ ] 2.1 In `src/bun/engine/pi/engine.ts`, remove `"glob"` from the `SDK_BUILTIN_TOOL_NAMES`-adjacent allowlist passed to `createAgentSession`
- [ ] 2.2 In `src/bun/engine/pi/tools/display.ts`, remove the `case "glob"` branch

## 3. Update tool descriptions

- [ ] 3.1 In `src/bun/engine/pi/tools/shell.ts`, update the `run_command` description to replace any reference to `glob` with `find`

## 4. Update tests

- [ ] 4.1 In `src/bun/test/tool-registry.test.ts`, remove the assertion `expect(names).toContain("glob")` and update the comment that says the `read` group contributes `glob`
- [ ] 4.2 Run `bun test src/bun/test/tool-registry.test.ts --timeout 20000` and confirm all tests pass
- [ ] 4.3 Run `bun test src/bun/test --timeout 20000` and confirm no regressions
