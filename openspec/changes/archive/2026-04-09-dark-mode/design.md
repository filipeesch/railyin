## Context

Railyn uses PrimeVue with the Aura theme. PrimeVue/Sakai ships dark-mode support through a `dark-mode` class on `<html>` — all semantic surface tokens (`--p-surface-card`, `--p-content-background`, etc.) automatically flip when that class is present. However, many components were using **palette tokens** (`--p-surface-0`, `--p-surface-50`, `--p-surface-100`) that are not semantic and do not flip automatically. Monaco Editor also requires an explicit theme string passed at initialization.

## Goals / Non-Goals

**Goals:**
- A persistent (localStorage) toggle button in the top bar, left of the Settings button.
- All components look correct in both light and dark mode.
- Monaco editor follows the active theme without a page reload.

**Non-Goals:**
- System/OS preference auto-detection (`prefers-color-scheme`) — manual toggle only.
- Per-board or per-task theme preferences.
- Any backend or API changes.

## Decisions

### 1. Class on `<html>` vs CSS custom property override

PrimeVue's Aura theme uses an `html.dark-mode` selector strategy (same as Sakai). Toggling a class on `<html>` is the correct integration point — it activates all of PrimeVue's built-in token flips for free.  
**Alternative considered**: injecting CSS variable overrides at runtime. Rejected — it duplicates what PrimeVue already does and is fragile against theme updates.

### 2. Shared composable (`useDarkMode`)

A singleton `ref` in a composable at module scope means all components share the same reactive state without a Pinia store. Persistence to `localStorage` is co-located with the state, applied immediately on module load (before Vue mounts) to avoid a flash of light mode.  
**Alternative considered**: Pinia store. Overkill for a single boolean; composable keeps the API minimal.

### 3. Explicit `html.dark-mode` CSS blocks for palette tokens

Components that used `--p-surface-0/50/100` needed manual dark overrides in non-scoped `<style>` blocks. The pattern adopted is:
- Light state: keep existing scoped styles with palette fallbacks.
- Dark state: add `html.dark-mode .<class>` overrides that replace backgrounds with `--p-surface-800/900` and borders with `--p-surface-700`.

This keeps light-mode styles unchanged (no regressions) and groups all dark overrides visibly at the bottom of each component.

### 4. Monaco editor theme prop

`MonacoDiffEditor` accepts a `theme` prop (`"vs"` or `"vs-dark"`). Parent components (`WorkflowEditorOverlay`, `CodeReviewOverlay`, `BoardView`) pass `isDark ? 'vs-dark' : 'vs'` and watch for changes via `watch` in the Monaco wrapper to call `monaco.editor.setTheme()` at runtime.

## Risks / Trade-offs

- **New palette token usages** → Any future component that uses `--p-surface-0/50/100` directly will be light-only until a dark override is added. Mitigation: the existing pattern is clear and consistent; a code review check is sufficient.
- **localStorage on first load** → The composable reads localStorage synchronously before Vue mounts to prevent FOUC, but this means it runs outside Vue's reactivity system. The approach is standard and well-tested.
- **Non-scoped styles** → Dark overrides use global `<style>` (not `<style scoped>`) to target `html.dark-mode` ancestor. This is intentional and the only way to write ancestor-conditional selectors in Vue SFCs.

## Migration Plan

Feature is additive — no migration needed. Default state is light mode (`localStorage` absent → `isDark = false`). Existing users see no change until they click the toggle.
