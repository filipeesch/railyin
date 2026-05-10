## Purpose
This delta spec removes `search_text` from the Pi engine's custom harness. Search functionality for Pi engine is now provided by Pi SDK's built-in `grep` tool (with `find`/`ls`). The existing `search-tools` spec remains valid for other engines (Claude, Copilot) that still use the native `search_text` implementation.

## Changes

### REMOVED Requirement: search_text in Pi engine
The `search_text` tool in the Pi engine custom harness SHALL be removed. Search for the Pi engine is provided by Pi SDK's built-in `grep` tool, which auto-downloads ripgrep when needed via `ensureTool("rg", true)`.

#### Scenario: search_text is not present in Pi tool registry
- **WHEN** `buildAllTools()` is called for a Pi engine session
- **THEN** no `search_text` tool is included in the returned tool array

### MODIFIED Requirement: search_internet handled separately
The `search_internet` tool (in Pi SDK's `web` tool group) SHALL remain unchanged. It provides web search functionality and is independent of file search. The Pi SDK `grep` tool handles file content search.

### Note on search caching
Pi SDK's `grep` has its own internal caching mechanism. Custom `ContentHashCache` `updateSearch`/`checkSearch` methods (used by the removed `search_text`) SHALL remain for compatibility with the `glob` tool in `read.ts` which uses them for file listing deduplication.
