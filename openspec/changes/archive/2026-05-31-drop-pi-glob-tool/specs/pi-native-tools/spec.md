## REMOVED Requirements

### Requirement: find_files tool
**Reason:** Replaced by the Pi SDK built-in `find` tool, which is gitignore-aware, uses `fd` for performance, and caps results at 1000. The custom implementation had an O(n log n) statSync performance bug in its sort comparator.
**Migration:** Models should use the SDK `find` tool for file pattern matching. No code migration required — `find` is already registered in `SDK_BUILTIN_TOOL_NAMES`.
