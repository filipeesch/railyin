## 1. Fix Conflicting Existing Test (prerequisite)

- [ ] 1.1 Update S-18 in `stream-tree-scenarios.test.ts`: rename `describe`/`it` descriptions to reflect the fixed behavior (`roots=[pre-r1, c1, t1]`); update assertions — `c1.parentBlockId` SHALL be `null`, `pre-r1.children` SHALL be `[]`, `c1.children` SHALL be `[r2]`
- [ ] 1.2 Add S-20 to `stream-tree-scenarios.test.ts`: bare tool_start (no parentCallId) after reasoning block — assert `c1.parentBlockId=null` and tree roots contain both reasoning and tool call as siblings

## 2. Backend Unit Tests — Claude Array Content (Bug #4)

- [ ] 2.1 Add CE-A to `claude-events.test.ts`: `content=[{type:'text',text:'hello'},{type:'text',text:'world'}]` → `detailedResult='hello\nworld'`
- [ ] 2.2 Add CE-B to `claude-events.test.ts`: `content='plain string'` → `detailedResult='plain string'` (passthrough unchanged)
- [ ] 2.3 Add CE-C to `claude-events.test.ts`: mixed blocks with image and text → only text block content in `detailedResult`
- [ ] 2.4 Add CE-D to `claude-events.test.ts`: `content=[]` → `detailedResult=''`

## 3. Backend Unit Tests — Copilot isInternal Fix (Bug #3) and Path Stripping (Bug #7)

- [ ] 3.1 Add CP-A to `copilot-events.test.ts`: `name='list_files'`, `parentToolCallId='parent-c1'` → `isInternal=false`
- [ ] 3.2 Add CP-B to `copilot-events.test.ts`: `name='report_intent'`, `parentToolCallId` set → `isInternal=true`
- [ ] 3.3 Add CP-C to `copilot-events.test.ts`: `name='skill-researcher'`, `parentToolCallId` set → `isInternal=true`
- [ ] 3.4 Add CP-D to `copilot-events.test.ts`: `name='internal_check'`, no `parentToolCallId` → `isInternal=true`
- [ ] 3.5 Add CP-E to `copilot-events.test.ts`: `name='list_files'`, no `parentToolCallId` → `isInternal=false`
- [ ] 3.6 Add CP-F to `copilot-events.test.ts`: bash command starting with worktreePath → `display.subject` stripped to relative path; call `translateCopilotStream(session, { worktreePath: '/fake/root' })`

## 4. Backend Unit Tests — Common Tools detailedContent (Bug #6)

- [ ] 4.1 Add CT-A to `common-tools-registration.test.ts`: `list_decisions` result text is valid JSON with a string `detailedContent` key
- [ ] 4.2 Add CT-B to `common-tools-registration.test.ts`: `create_todo` result `detailedContent` is human-readable (does not contain raw JSON object notation)
- [ ] 4.3 Add CT-C to `common-tools-registration.test.ts`: `record_decision` result `detailedContent` is a non-empty string

## 5. Backend Integration Test — IPC parentBlockId (Bug #1)

- [ ] 5.1 Add S-12 to `stream-pipeline-scenarios.test.ts`: use ScriptedEngine checkpoint — emit reasoning → checkpoint after tool_start → assert IPC `tool_start` event has `parentBlockId=null`

## 6. Playwright E2E — ReasoningBubble (Bug #2)

- [ ] 6.1 Add A-X1 to `stream-reactivity.spec.ts`: reasoning bubble content area is not visible (collapsed) immediately after first reasoning chunk arrives
- [ ] 6.2 Add A-X2 to `stream-reactivity.spec.ts`: bubble header text is "Reasoning…" while streaming active
- [ ] 6.3 Add A-X3 to `stream-reactivity.spec.ts`: bubble header text changes to "Reasoned" when stream done
- [ ] 6.4 Add A-X4 to `stream-reactivity.spec.ts`: tool_call block with no parentBlockId renders as DOM sibling, not child of reasoning bubble container

## 7. Playwright E2E — Tool Rendering Bugs (#3, #6, #7)

- [ ] 7.1 Add S-28 to `tool-rendering.spec.ts`: tool_start with parentBlockId renders nested under parent tool call when parent is expanded
- [ ] 7.2 Add S-29 to `tool-rendering.spec.ts`: tool result with `detailedContent` shows human text; DOM does not contain raw JSON braces
- [ ] 7.3 Add S-30 to `tool-rendering.spec.ts`: bash tool_start with relative display.subject does not show absolute path in subject text

## 8. Playwright E2E — Layout and Decision UI (Bugs #8, #9)

- [ ] 8.1 Add CB-3 to `conversation-body.spec.ts`: after rendering wide content, `scrollWidth === clientWidth` (no horizontal scroll)
- [ ] 8.2 Add T-L to `interview-me.spec.ts`: after submitting a decision with bold text, user bubble contains `<strong>` element and no raw `**` characters
- [ ] 8.3 Add T-M to `interview-me.spec.ts`: after form submission, `.decision-answered-view` element is absent from the DOM

## 9. Verification

- [ ] 9.1 Run `bun test src/bun/test --timeout 20000` — all tests pass including updated S-18
- [ ] 9.2 Run `bun run build && npx playwright test e2e/ui --timeout 60000` — all new E2E specs pass
