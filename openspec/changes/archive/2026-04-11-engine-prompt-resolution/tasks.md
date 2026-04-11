## 1. Move resolver to engine dialect layer

- [x] 1.1 Copy `src/bun/workflow/slash-prompt.ts` to `src/bun/engine/dialects/copilot-prompt-resolver.ts` — rename the exported function from `resolveSlashReference` to `resolvePrompt`, keep all logic intact including the `process.cwd()` fallback
- [x] 1.2 Update `src/bun/test/slash-prompt.test.ts` import path to point to the new location; verify tests still pass

## 2. Remove resolution from orchestrator

- [x] 2.1 In `src/bun/engine/orchestrator.ts`: remove `import { resolveSlashReference }` and both call sites (transition path + human-turn path)
- [x] 2.2 In `src/bun/engine/orchestrator.ts`: remove the `resolved_content` / `display_content` metadata writes from `appendMessage` calls — pass `undefined` metadata for prompt messages
- [x] 2.3 In `src/bun/workflow/engine.ts`: remove the two `resolveSlashReference` call sites (column-entry path and human-turn path); pass raw prompt to execution functions

## 3. Add resolution to Native and Copilot engines

- [x] 3.1 In `src/bun/engine/native/engine.ts`: import `resolvePrompt` from `engine/dialects/copilot-prompt-resolver.ts`; call it on `params.prompt` (with `params.workingDirectory`) before passing to the underlying LLM call
- [x] 3.2 In `src/bun/engine/copilot/engine.ts`: import `resolvePrompt`; call it on `params.prompt` (with `params.workingDirectory`) before `session.send()`

## 4. Verify Claude engine passes prompt raw

- [x] 4.1 Confirm `src/bun/engine/claude/engine.ts` has no slash-resolution logic and passes `params.prompt` directly to the SDK query — no code change expected, just verify and document

## 5. Cleanup

- [x] 5.1 Delete `src/bun/workflow/slash-prompt.ts` (now superseded by `engine/dialects/copilot-prompt-resolver.ts`)
- [x] 5.2 Search for any remaining imports of `slash-prompt.ts` in the codebase and update or remove them
- [x] 5.3 Verify no UI code reads `metadata.resolved_content` or `metadata.display_content` from conversation messages; remove any such reads
