## Why

Autocomplete chips currently degrade after send: slash commands, file references, and MCP tool references are shown in sent user messages as plain text without their `/`, `#`, or `@` semantics. The same chip-to-plain-text conversion also breaks slash-command handling by stripping the leading `/` before the prompt reaches the engine, so custom commands stop resolving correctly.

## What Changes

- Preserve autocomplete selections as chip markup in newly stored user-message content instead of flattening them to plain labels at send time
- Render slash-command, file/symbol, and MCP tool references as rich chips in sent user-message bubbles, matching the compose experience more closely
- Include the sigil in chip labels shown in the editor and conversation bubbles (`/command`, `#file`, `@tool`)
- Derive a plain/raw engine prompt from stored chip markup before execution so engines receive slash commands and clean human text while file references continue to flow through attachments
- Keep existing older plain-text messages unchanged; only newly created messages use the richer chip-preserving behavior

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `chat-editor`: autocomplete chips need to preserve sigils in their visible labels and store chip markup for newly sent messages
- `conversation`: newly sent user messages need to render preserved chip markup as rich chips while remaining compatible with full-history context assembly
- `slash-prompt-resolution`: slash invocations selected from autocomplete need to reach the engine with the leading `/` intact so command resolution works again

## Impact

- Affected frontend code in the shared chat editor, conversation input flow, and user message bubble rendering
- Affected backend send and conversation/context assembly paths that currently treat stored user-message content as the exact engine prompt
- No new external dependencies or APIs, but conversation storage and engine prompt derivation behavior change for newly created user messages
