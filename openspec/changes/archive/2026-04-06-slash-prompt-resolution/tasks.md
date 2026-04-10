## 1. Slash Reference Resolver

- [x] 1.1 Create a `resolveSlashReference(value: string, worktreePath: string): Promise<string>` utility that detects `/namespace:command [arg]` pattern, reads the prompt file, strips frontmatter, and substitutes `$input`
- [x] 1.2 Return the value unchanged (not an error) when the value does not match the slash pattern
- [x] 1.3 Throw a descriptive error when the slash pattern matches but the file is not found at the resolved path
- [x] 1.4 Add unit tests: valid reference resolves, frontmatter stripped, `$input` substituted, no-arg empties `$input`, non-slash passthrough, missing file throws

## 2. Workflow Engine Integration

- [x] 2.1 In the column-entry execution path, call `resolveSlashReference` on `on_enter_prompt` before constructing the AI request
- [x] 2.2 In the stage instructions injection path, call `resolveSlashReference` on `stage_instructions` before prepending as system message
- [x] 2.3 Surface resolution errors as a failed execution state with the error message in the conversation

## 3. Human Turn Integration

- [x] 3.1 In the human turn handler, detect when the user message starts with `/namespace:command` pattern
- [x] 3.2 Resolve the slash reference using the task's worktree path; substitute `$input` with any trailing text
- [x] 3.3 Replace the raw user message with the resolved prompt body before forwarding to the AI
- [x] 3.4 On resolution failure, return an error message to the user in the conversation and do not forward to the AI

## 4. Validation & Docs

- [x] 4.1 Update `config/workflows/delivery.yaml` comments to document the `/namespace:command` syntax as an accepted value for `on_enter_prompt` and `stage_instructions`
- [x] 4.2 Update `config/workspace.yaml.sample` (or workflow YAML sample) with an example column using a slash reference
