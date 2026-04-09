## Why

The app had no dark mode, forcing users who prefer low-light environments to work with a bright white UI. PrimeVue/Sakai already ship dark-mode token support; wiring it up gives users immediate relief with minimal risk.

## What Changes

- **New `useDarkMode` composable** — manages the boolean state, persists it to `localStorage`, and toggles `dark-mode` class on `<html>` (the selector PrimeVue/Sakai use to flip surface tokens).
- **Toggle button in the top bar** — a moon/sun icon button placed immediately to the left of the existing Settings button, visible on every screen.
- **Dark overrides for all Vue components** — `html.dark-mode` CSS blocks added to every component that used light-only palette tokens (`--p-surface-0/50/100/200`) so they flip correctly in dark mode.
- **Monaco editor theme switching** — `MonacoDiffEditor`, `WorkflowEditorOverlay`, and `CodeReviewOverlay` now receive the active theme (`vs-dark` / `vs`) and react to live changes.
- **Surface token audit** — replaced hardcoded light palette tokens with semantic alternatives or explicit `html.dark-mode` overrides across 22 files.

## Capabilities

### New Capabilities

- `dark-mode`: User-facing dark theme toggle with persistence; applies PrimeVue dark tokens app-wide and handles Monaco editor theme switching.

### Modified Capabilities

<!-- No existing spec-level requirements changed -->

## Impact

- **UI layer only** — no API, data model, or backend changes.
- **Files touched**: `src/mainview/composables/useDarkMode.ts` (new), `src/mainview/views/BoardView.vue`, `src/mainview/App.vue`, and 19 component files under `src/mainview/components/`.
- **Dependencies**: PrimeVue Aura theme (already present), Monaco Editor (already present).
- **localStorage key**: `railyn-dark-mode` (`"true"` / `"false"`).
