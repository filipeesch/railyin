# Railyin - Engine Management UI

## What This Is

Railyin is an AI agent execution platform with a Vue 3 board-based UI, supporting multiple AI engine backends (GitHub Copilot, Claude, Cursor, Pi/local LLMs). It manages conversations, tasks, workflows, and engine configurations via a web interface with real-time WebSocket streaming.

**Current state:** The engine configuration system lives in YAML files (~/.railyn/config/engines.yaml). A raw Monaco text editor exists in an overlay dialog for editing the YAML directly. There is no structured UI for engine management — users must edit YAML by hand.

## Core Value

Engine configurations must be editable through a structured, accessible UI — not raw YAML text. This enables anyone to share, import, and manage engine setups without deep YAML knowledge.

## Project Shape

- **Complexity:** complex
- **Why:** Multiple engine types with nested config structures (models, variants, providers, sampling presets), dual-editor UI (forms + Monaco), import/export with merge conflict resolution
- **Web stack:** Vue 3 + PrimeVue + Pinia, served by Bun backend, Playwright for UI tests

## Current State

- Engine list is loaded from `engines.yaml` via backend config system
- A raw YAML editor overlay exists (`EnginesEditorOverlay.vue`) using Monaco
- RPC handlers: `config.getEnginesYaml`, `config.saveEnginesYaml` (invalidates config cache on save)
- Engine types supported: copilot, claude, cursor, pi (opencode, scripted are legacy)
- Save invalidates config cache → no restart needed

## Architecture / Key Patterns

- **Backend:** Bun server with RPC handlers in `src/bun/handlers/`. Config loaded from `~/.railyn/config/`.
- **Frontend:** Vue 3 + Pinia stores in `src/mainview/stores/`. Components in `src/mainview/components/`.
- **Shared types:** `src/shared/rpc-types.ts` defines API contract.
- **Testing:** Bun vitest for backend, Playwright for UI (mocks API via `e2e/ui/fixtures/mock-api.ts`).
- **Config persistence:** YAML files read/written via `fs`. Cache invalidated on save.

## Capability Contract

See `.gsd/REQUIREMENTS.md` for the explicit capability contract.

## Milestone Sequence

- [ ] M001: Engine Management UI — structured list + form editor for engine configs, model/variant management, import/export, live reload