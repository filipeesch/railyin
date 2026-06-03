## 1. Merge from main

- [x] 1.1 Merge `origin/main` into the working branch (1 commit behind: Pi sampling presets)

## 2. decision_request — Schema & Description

- [x] 2.1 Add `minItems: 2` to the `options` array schema in `decision-request-tool-definition.ts`
- [x] 2.2 Rewrite the top-level `description` string to be concise and non-redundant: state when to use the tool, that options MUST NOT be embedded in question text, and the ≥ 2 options rule for exclusive/non_exclusive
- [x] 2.3 Trim field-level descriptions in `decision-request-tool-definition.ts` to remove content now covered by the top-level description

## 3. decision_request — Runtime Validation

- [x] 3.1 In `executeCommonTool` (`common-tools.ts`), add a type-aware options-count check after `validateToolArgs` passes: for each question where `type !== "freetext"`, verify `options.length >= 2`; return a `{ type: "result", text: <error> }` if the check fails with a message that names the question index and instructs not to embed options in question text

## 4. SkillResolver — list() interface & implementation

- [x] 4.1 Add `list(): Promise<string[]>` to the `SkillResolver` interface in `skill-resolver.ts`
- [x] 4.2 Implement `list()` in `FileSystemSkillResolver`: iterate `this.paths`, read each directory's entries (skip non-existent directories silently), collect names of subdirectories containing `SKILL.md`, deduplicate first-path-wins

## 5. skill tool — Enriched error message

- [x] 5.1 In `skill.ts` execute function, on `resolver.resolve()` returning null: call `resolver.list()` to get available names
- [x] 5.2 Build a case-insensitive lookup from available names; if `args.name.toLowerCase()` matches, prepend "Did you mean: `<name>`?" to the error
- [x] 5.3 Append the full list of available skill names to the error; if the list is empty, say "No skills are currently available" instead of referencing the `<available_skills>` list

## 6. Board tool schemas — Remove board_id

- [x] 6.1 Remove the `board_id` property from `get_board_summary` parameters in `registry.ts`
- [x] 6.2 Remove the `board_id` property from `list_tasks` parameters in `registry.ts`
- [x] 6.3 Remove the `board_id` property from `create_task` parameters in `registry.ts`
- [x] 6.4 Update the tool summary strings (lines ~527–530 of `registry.ts`) for the three affected tools to remove board_id mentions

## 7. Verify

- [x] 7.1 Run `bun test src/bun/test --timeout 20000` and confirm no regressions
