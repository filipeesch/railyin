## 1. Remove delegate registration in tools/index.ts

- [ ] 1.1 Comment out `import { buildDelegateTool } from "./delegate.ts"`
- [ ] 1.2 Comment out `import type { ChildSessionFactory } from "../child-session.ts"`
- [ ] 1.3 Remove delegate-only fields from `AllToolsOptions` interface: `delegateEmitRef`, `childSessionFactory`, `limiterRegistry`, `parentModel`, `parentSystemPrompt`, `parentConversationId`, `parentCwd`, `engineConfig`, `onRawModelMessage`
- [ ] 1.4 Remove `CHILD_COMMON_TOOL_NAMES` constant export
- [ ] 1.5 Remove `buildChildTools()` function
- [ ] 1.6 In `buildAllTools()`: remove `childToolsBuilder` variable, `delegateTools` variable, and `...delegateTools` from the return spread
- [ ] 1.7 Update JSDoc comment on `buildAllTools()` to remove delegate reference

## 2. Comment out delegate infrastructure in engine.ts

- [ ] 2.1 Comment out `private readonly delegateEmitRefs = new Map<...>()` field
- [ ] 2.2 In `buildAllTools()` call within `createManagedExecution()`: comment out `delegateEmitRef`, `limiterRegistry`, `parentModel`, `parentSystemPrompt`, `parentConversationId`, `parentCwd`, `engineConfig`, `onRawModelMessage` options
- [ ] 2.3 Comment out `delegateEmitRef` event wiring: `const delegateEmitRef = ...` and `delegateEmitRef.emit = ...`
- [ ] 2.4 Comment out `this.delegateEmitRefs.clear()` in `shutdown()`
- [ ] 2.5 Comment out `getOrCreateDelegateEmitRef()` method

## 3. Comment out delegate display case in display.ts

- [ ] 3.1 Comment out `case "delegate":` and its return in `buildPiToolDisplay()`

## 4. Verify compilation

- [ ] 4.1 Run `bun run build` and confirm no TypeScript errors in modified files
- [ ] 4.2 Confirm no unused import warnings in `tools/index.ts` and `engine.ts`
