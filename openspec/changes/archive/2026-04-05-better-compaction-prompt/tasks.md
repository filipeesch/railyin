## 1. Replace Compaction Prompt

- [x] 1.1 Replace `COMPACTION_SYSTEM_PROMPT` constant in `engine.ts` with the new structured multi-section compaction prompt (9 sections: primary request, key concepts, files/code, errors/fixes, problem solving, user messages verbatim, pending tasks, current work, optional next step)
- [x] 1.2 Update the prompt to instruct the model to write an `<analysis>` scratchpad block followed by a `<summary>` block, with the analysis block used for reasoning only

## 2. Strip Analysis Block from Stored Summary

- [x] 2.1 After receiving the model response in `compactConversation()`, extract only the content inside `<summary>...</summary>` tags if present; fall back to the full response if no tags detected
- [x] 2.2 Pass the stripped summary (not the raw response) to `appendMessage()` for storage as `compaction_summary`

## 3. Tests

- [x] 3.1 Add a unit test in `engine.test.ts` verifying that when the model response contains `<analysis>...</analysis><summary>...</summary>`, only the summary content is stored
- [x] 3.2 Add a test verifying that when no `<analysis>` block is present, the full response is stored unchanged
