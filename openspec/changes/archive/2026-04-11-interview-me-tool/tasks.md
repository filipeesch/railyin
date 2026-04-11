## 1. Shared Types

- [x] 1.1 Add `InterviewOption` type to `src/shared/rpc-types.ts`: `{ title: string; description: string }`
- [x] 1.2 Add `InterviewQuestion` type to `src/shared/rpc-types.ts`: `{ question: string; type: "exclusive" | "non_exclusive" | "freetext"; weight?: "critical" | "medium" | "easy"; model_lean?: string; model_lean_reason?: string; answers_affect_followup?: boolean; options?: InterviewOption[] }`
- [x] 1.3 Add `InterviewPayload` type to `src/shared/rpc-types.ts`: `{ context?: string; questions: InterviewQuestion[] }`

## 2. Tool Definition (Native Engine)

- [x] 2.1 Add `interview_me` tool definition to `src/bun/workflow/tools.ts` with full JSON schema matching `InterviewPayload`. Tool description MUST include "ALWAYS use this tool instead of plain prose when seeking architectural direction, technology choices, or any decision where context and tradeoffs matter."
- [x] 2.2 Register `interview_me` in the `interactions` tool group in `src/bun/workflow/tools.ts` (alongside `ask_me`)
- [x] 2.3 Add `interview_me` entry to the tool hint map in `src/bun/workflow/tools.ts`

## 3. Tool Definition (Copilot Engine)

- [x] 3.1 Add `interview_me` tool definition to the Copilot engine's tool registration (mirrors native definition). Check `src/bun/engine/copilot/` for the equivalent of `workflow/tools.ts` and add it there.

## 4. Engine Event Type

- [x] 4.1 Add `{ type: "interview_me"; payload: string }` variant to the `EngineEvent` union in `src/bun/engine/types.ts`

## 5. Native Engine Intercept

- [x] 5.1 In `src/bun/workflow/engine.ts`, add intercept for `interview_me` tool calls in the tool loop (same location as the `ask_me` intercept)
- [x] 5.2 Parse and normalize the payload: validate `questions` array is non-empty, each question has `question` text and valid `type`, options (if present) have `title` and `description`
- [x] 5.3 Implement nudge logic: if payload is invalid/empty, push a tool error message and retry up to 3 times before skipping (same pattern as `ask_me`)
- [x] 5.4 On valid payload: write an `interview_prompt` conversation message with serialized JSON, emit `onNewMessage`, set `execution_state = 'waiting_user'`, stop the tool loop

## 6. Copilot Engine Intercept

- [x] 6.1 In `src/bun/engine/copilot/` (events or session handler), add the same `interview_me` intercept: normalize, write `interview_prompt` message, set `waiting_user`, stop loop
- [x] 6.2 Add `session.interview_me` event type in `src/bun/engine/copilot/session.ts` and map it to an `interview_me` EngineEvent in `src/bun/engine/copilot/events.ts`

## 7. Orchestrator

- [x] 7.1 In `src/bun/engine/orchestrator.ts`, handle the `interview_me` EngineEvent: set `execution_state = 'waiting_user'`, update execution status, fire streaming-done signal (same pattern as `ask_user`)

## 8. Frontend Component — `InterviewMe.vue`

- [x] 8.1 Create `src/mainview/components/InterviewMe.vue` accepting props: `questions: InterviewQuestion[]`, `context?: string`, `answeredText?: string`
- [x] 8.2 Render optional `context` preamble as markdown above all questions
- [x] 8.3 Render weight badge per question: `critical` → amber ⚠️, `medium` → blue 🔄, `easy` → green 💡
- [x] 8.4 Render model lean line per question when `model_lean` is set: `"🤖 I lean toward [title] · [reason]"` in a subtle muted style
- [x] 8.5 Render `answers_affect_followup` hint when set: `"✦ Your answer here will shape follow-up questions"` as a small note
- [x] 8.6 Render option rows as clickable divs (no radio buttons for `exclusive`). Row click = focus that option. Hover state with cursor pointer. Selected row gets highlight background.
- [x] 8.7 For `non_exclusive` questions: render a checkbox per option. Checkbox click = toggle selection. Row click (not on checkbox) = focus for description. The two gestures are independent.
- [x] 8.8 Always include an "Other" row at the end of the option list for `exclusive` and `non_exclusive` questions
- [x] 8.9 Render fixed-height markdown description panel below the option list: `min-height: 200px`, `max-height: 400px`, `overflow-y: auto`. Show placeholder text `"Select an option to see details."` when nothing is focused.
- [x] 8.10 Apply opacity cross-fade (~100ms transition) when the focused option changes. No height change, no layout shift.
- [x] 8.11 When "Other" is focused: replace the description panel with a textarea for free input; hide the Notes field
- [x] 8.12 Render Notes textarea (`min-height: 80px`, optional label) below the description panel for `exclusive` and `non_exclusive` questions, unless "Other" is focused
- [x] 8.13 For `freetext` questions: render only a textarea (`min-height: 120px`), no options, no description panel, no Notes
- [x] 8.14 Render Submit button disabled until all questions have a valid answer (selection made or freetext non-empty; Other selected requires its textarea to be non-empty)
- [x] 8.15 On submit: serialize answers in Q/A/Notes format (see design.md §5), emit `submit` event with the string
- [x] 8.16 When `answeredText` prop is set: render compact read-only summary (one line per question: `✓ [question] → [answer]`, Notes on next line if present)
- [x] 8.17 Apply dark mode styles consistent with `AskUserPrompt.vue`

## 9. Message Routing

- [x] 9.1 In `src/mainview/components/MessageBubble.vue`, add a case for `interview_prompt` message type that renders `InterviewMe.vue` with the parsed payload, passing `answeredText` when a following user message exists (same pattern as `ask_user_prompt`)

## 10. Message Assembly

- [x] 10.1 Ensure `interview_prompt` messages are excluded from the LLM message assembly (same exclusion list as `ask_user_prompt`, `file_diff`, etc.) in `src/bun/workflow/engine.ts`

## 11. Tests

- [x] 11.1 Add engine test: `interview_me` tool call sets `execution_state = 'waiting_user'` and writes an `interview_prompt` message
- [x] 11.2 Add engine test: empty `interview_me` call triggers nudge, valid retry writes message
- [x] 11.3 Add message assembly test: `interview_prompt` messages are not sent to the LLM
- [x] 11.4 Add tools test: `resolveToolsForColumn(["read", "interview_me"])` includes `interview_me` definition
