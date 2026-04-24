## Why

The native engine path is intentionally obsolete and will be replaced rather than preserved. Keeping the legacy workflow engine, native adapter, and config compatibility code in place adds thousands of lines of dead code, obscures the real execution paths, and raises the maintenance cost of every engine-related change.

## What Changes

- **BREAKING** Remove support for `engine.type: native` from runtime resolution and workspace configuration.
- Delete the legacy workflow/native engine implementation and its adapter layer once the supported engines are Copilot and Claude only.
- Remove native-engine-specific config parsing, validation, and tests that no longer apply.
- Tighten engine resolution and lifecycle behavior around the supported engines only.

## Capabilities

### New Capabilities

### Modified Capabilities
- `execution-engine`: Remove native engine support from the shared engine contract and supported resolver targets
- `workspace`: Remove workspace configuration support for `engine.type: native` and document supported engine choices

## Impact

- Backend engine code: `src/bun/workflow/*`, `src/bun/engine/native/*`, engine resolver/config handling
- Workspace config parsing and validation in `src/bun/config/index.ts`
- Engine-related tests and fixtures that still reference native behavior
- Existing workspaces using native engine config will need to migrate to a supported engine before applying this change
