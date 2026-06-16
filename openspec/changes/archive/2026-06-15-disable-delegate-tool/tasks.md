## 1. Remove delegate registration in tools/index.ts

- [x] 1.1 Comment out `import { buildDelegateTool } from "./delegate.ts"`
- [x] 1.2 Comment out `import type { ChildSessionFactory } from "../child-session.ts"`
- [x] 1.3 Remove delegate-only fields from `AllToolsOptions` interface: `delegateEmitRef`, `childSessionFactory`, `limiterRegistry`, `parentModel`, `parentSystemPrompt`, `parentConversationId`, `parentCwd`, `engineConfig`, `onRawModelMessage`
- [x] 1.4 Remove `CHILD_COMMON_TOOL_NAMES` constant export
- [x] 1.5 Remove `buildChildTools()` function
- [x] 1.6 In `buildAllTools()`: remove `childToolsBuilder` variable, `delegateTools` variable, and `...delegateTools` from the return spread
- [x] 1.7 Update JSDoc comment on `buildAllTools()` to remove delegate reference

## 2. Comment out delegate infrastructure in engine.ts

- [x] 2.1 Comment out `private readonly delegateEmitRefs = new Map<...>()` field
- [x] 2.2 In `buildAllTools()` call within `createManagedExecution()`: comment out `delegateEmitRef`, `limiterRegistry`, `parentModel`, `parentSystemPrompt`, `parentConversationId`, `parentCwd`, `engineConfig`, `onRawModelMessage` options
- [x] 2.3 Comment out `delegateEmitRef` event wiring: `const delegateEmitRef = ...` and `delegateEmitRef.emit = ...`
- [x] 2.4 Comment out `this.delegateEmitRefs.clear()` in `shutdown()`
- [x] 2.5 Comment out `getOrCreateDelegateEmitRef()` method

## 3. Comment out delegate display case in display.ts

- [x] 3.1 Comment out `case "delegate":` and its return in `buildPiToolDisplay()`

## 4. Verify compilation

- [x] 4.1 Run `bun run build` and confirm no TypeScript errors in modified files
- [x] 4.2 Confirm no unused import warnings in `tools/index.ts` and `engine.ts`
- [x] 4.3 Fix `tool-registry.test.ts` — remove `buildChildTools` import and test block (was causing TS2724 in GitHub Actions Type Check)
- [x] 4.4 Confirmed 2 Backend Tests failures are flaky CI tests (pass 3/3 locally, unrelated to delegate changes)
