## 1. Conversation contract and transition persistence

- [x] 1.1 Extend transition event typing and message mapping to support structured entered-column instruction metadata.
- [x] 1.2 Update column-entry execution persistence so prompted transitions write enriched `transition_event` metadata and stop relying on a standalone visible prompt row for new history.

## 2. Transition card UI

- [x] 2.1 Extract a dedicated task-chat transition card path so entered-column transitions are rendered outside the generic prompt bubble flow.
- [x] 2.2 Add collapsed instruction disclosure and render expanded instruction text with the same inline chip styling used for normal chat prompt content.

## 3. Backward compatibility and cleanup

- [x] 3.1 Keep legacy conversations readable while preventing duplicate prompt-first presentation for new prompted transitions.
- [x] 3.2 Refactor shared prompt-like text rendering so transition instructions and normal chat prompts reuse the same segmentation logic without expanding `MessageBubble.vue` into a god component.

## 4. Verification

- [x] 4.1 Write and run e2e tests for column prompt chat UX.
