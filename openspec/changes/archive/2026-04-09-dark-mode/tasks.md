## 1. Dark Mode Composable

- [x] 1.1 Create `src/mainview/composables/useDarkMode.ts` with singleton `isDark` ref, localStorage persistence (`railyn-dark-mode`), and `toggle()` function
- [x] 1.2 Apply `dark-mode` class to `<html>` on module load (before Vue mounts) to prevent flash of light mode
- [x] 1.3 Watch `isDark` and sync class + localStorage on every change

## 2. Toggle Button in Top Bar

- [x] 2.1 Import `useDarkMode` in `BoardView.vue` and wire `isDark` / `toggleDark`
- [x] 2.2 Add moon/sun PrimeVue Button immediately left of the Settings button with correct aria-labels

## 3. Monaco Editor Theme Switching

- [x] 3.1 Add `theme` prop to `MonacoDiffEditor.vue` and call `monaco.editor.setTheme()` when the prop changes
- [x] 3.2 Pass `isDark ? 'vs-dark' : 'vs'` theme from `WorkflowEditorOverlay.vue`
- [x] 3.3 Pass `isDark ? 'vs-dark' : 'vs'` theme from `CodeReviewOverlay.vue`

## 4. Semantic Token Fixes (Board, Header, Cards)

- [x] 4.1 Replace palette surface tokens with semantic PrimeVue tokens in `BoardView.vue` header and task cards (`TaskCard.vue`)
- [x] 4.2 Fix `TodoPanel.vue` and `MessageBubble.vue` to use semantic tokens
- [x] 4.3 Fix `TaskDetailDrawer.vue` — input area, sidebar, launch bar, warning dialogs dark overrides

## 5. Component Dark Overrides — Collapsibles & Diffs

- [x] 5.1 Add `html.dark-mode` overrides to `ToolCallGroup.vue` (header, hover, body, border, stat badges)
- [x] 5.2 Add `html.dark-mode` overrides to `CodeReviewCard.vue` (header, hover, badge states, hunk states)
- [x] 5.3 Add `html.dark-mode` overrides to `FileDiff.vue` (hunk header, load-more, added/removed lines, tag badges)
- [x] 5.4 Add `html.dark-mode` overrides to `ReadView.vue` (load-more button and hover)
- [x] 5.5 Add `html.dark-mode` overrides to `ReasoningBubble.vue` (header, hover, body, border)

## 6. Component Dark Overrides — Code Review Overlay & File List

- [x] 6.1 Fix `CodeReviewOverlay.vue` — replace palette tokens, fix active file state and changed-badge
- [x] 6.2 Fix `ReviewFileList.vue` — active item background using semantic tokens

## 7. Component Dark Overrides — HunkActionBar

- [x] 7.1 Add `html.dark-mode` overrides for `HunkActionBar.vue` comment boxes, action bar, and all button states (accept/reject/active)
- [x] 7.2 Use non-scoped `<style>` block so `html.dark-mode` ancestor selector works correctly

## 8. Component Dark Overrides — Remaining Components

- [x] 8.1 Add `html.dark-mode` overrides to `ShellApprovalPrompt.vue` (command block bg, code text color)
- [x] 8.2 Add `html.dark-mode` overrides to `WorkflowEditorOverlay.vue` (overlay bg, header, note bar, footer, save-error)
- [x] 8.3 Add `html.dark-mode` overrides to `AskUserPrompt.vue` (prompt bg, question/option text, free-text input)
- [x] 8.4 Add `html.dark-mode` overrides to `LspSetupPrompt.vue` (language cards bg + border)
- [x] 8.5 Add `html.dark-mode` overrides to `ModelTreeView.vue` (thinking-toggle row bg)
- [x] 8.6 Add `html.dark-mode` overrides to `SetupView.vue` (page bg, card, config summary, project list borders)
