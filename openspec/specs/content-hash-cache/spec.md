## Purpose
`ContentHashCache` was retired when Pi engine support was introduced. Local LLMs have no prompt cache — they hold full conversation history in their context window — making the marker messages meaningless and a source of model confusion. All Pi tools (`read_file`, `glob`, `search_text`) now always return full content.

## Requirements

*All requirements retired. See pi-engine-improvements change for rationale.*
