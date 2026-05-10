## REMOVED Requirements

### Requirement: Per-conversation cache
**Reason**: `ContentHashCache` was designed to optimize prompt caching with Claude, where re-sending unchanged file content wastes expensive cache slots. Local LLMs (Pi engine targets) have no prompt cache — they hold full conversation history in their context window. The "use your cached version" short-circuit messages are meaningless to local models, pollute context with undefined references, and can cause the model to loop trying to retrieve content it cannot access. Removing the cache simplifies `HarnessContext` and eliminates a class of LLM confusion bugs.
**Migration**: No migration needed. Pi tools (`read_file`, `glob`, `search_text`) now always return full content. Write and undo operations no longer call `invalidate()`.

### Requirement: File read deduplication
**Reason**: Removed with Per-conversation cache (see above). All callers in `tools/read.ts` are deleted.
**Migration**: None required.

### Requirement: Write invalidation
**Reason**: Removed with Per-conversation cache. Write tools (`write_file`, `patch_file`, `move_file`) no longer call `hashCache.invalidate()`.
**Migration**: None required.

### Requirement: Compaction boundary reset
**Reason**: Removed with Per-conversation cache. `PiEngine.compact()` no longer calls `hashCache.resetWindowFlags()`. Compaction is now handled by Pi SDK's `session.compact()`.
**Migration**: None required.

### Requirement: Search result deduplication
**Reason**: Removed with Per-conversation cache. All callers in `tools/search.ts` are deleted.
**Migration**: None required.
