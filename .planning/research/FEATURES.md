# Feature Research: AG-UI + CopilotKit Chat Stack

**Domain:** Agent-chat UX for a single-user local-first workflow board (Bun + Vue 3) with pluggable coding-agent engines (pi/claude/copilot/cursor/opencode)
**Researched:** 2026-08-08
**Confidence:** MEDIUM — CopilotKit/AG-UI docs verified via Context7 (official docs); 2026 UX-baseline findings cross-checked across multiple sources. CopilotKit Vue is early-access: pin versions and re-verify the exact API surface during the phase.

## Feature Landscape

### Table Stakes (Users Expect These)

For this product, "users" is one operator driving coding agents on task cards. Baseline comes from 2026 agent-chat expectations (ChatGPT/Claude/Perplexity/Cursor/Codex) plus Railyin's own existing behavior — regression is as bad as absence.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| Token-by-token streaming chat | 2026 baseline: "get streaming right or a fast model feels broken" | LOW | Free from stack: AG-UI text events + CopilotKit streaming with live cursor. The bridge must map `EngineEvent` deltas → AG-UI `TEXT_MESSAGE_*` events. |
| Stable-layout markdown + code blocks | Baseline for all AI chat; coding output is markdown-heavy | LOW | CopilotKit default message renderer handles it. Verify code-block rendering quality vs the old CodeMirror-based editor; plan CSS/slot overrides if degraded. |
| Tool-call visibility (default card) | 2026 baseline: "live tool execution visibility — each tool call shown with inputs, outputs, status"; hidden tool calls = broken trust | LOW | `useDefaultRenderTool` gives an expandable card (name, status inProgress/executing/complete, args, result) for free. Covers all generic MCP/discovery tools. |
| Cancel / stop streaming | Baseline: prominent stop control while running; must propagate to the agent, not just the UI | MEDIUM | `isRunning` prop + runner `stop()`. Risk: not all five engine SDKs support mid-run abort — bridge needs best-effort abort + partial-state labeling ("stopped"). |
| Regenerate / retry | Baseline: retry affordance with partial response preserved | MEDIUM | **No dedicated regenerate API confirmed in CopilotKit Vue v2 docs — verify in phase.** Fallback is cheap with JSONL: replay thread + re-run. Mark as P2 risk. |
| Threads + per-thread persistence | A conversation that vanishes on restart is broken; threads are the unit of everything (cards, sessions) | HIGH | Core milestone work: custom `RailyinAgentRunner` (subclass `InMemoryAgentRunner`, override run/connect) writing `data/threads/{threadId}.jsonl`. No official JSONL runner exists. |
| Thread history / listing | User must navigate board conversations and standalone sessions | MEDIUM | `useThreads` on self-hosted runtime is a documented risk; fallback = own thread-index endpoint (we own the files). Rename/archive/delete optional. |
| Human-in-the-loop: decision_request as interrupt | **Core product value** (decision-request workflow) — non-negotiable | MEDIUM | AG-UI native: `RUN_FINISHED { outcome: interrupt, interrupts: [{id, reason, message}] }`, resume via `RunAgentInput.resume`. Bridge maps `on_interrupt` → interrupt; run pauses instead of ending. |
| Reasoning / thinking display | Baseline for coding agents (Claude extended thinking, o-series, Cursor); pi engines already emit thinking (thinkingFormat config) | LOW | Zero-config `CopilotChatReasoningMessage` card: Thinking indicator, live markdown chain-of-thought, collapsible summary + duration. Bridge must route engine thinking → AG-UI `REASONING_*` events. |
| Slash commands + prompt refs parity | Existing Railyin feature (slash commands, `/prompt-name` refs) — must not regress | MEDIUM | `CopilotChatInput` `toolsMenu` prop provides slash-command affordance; wire to existing command registry. Keep the "reference must be entire leading value" convention. |
| Legacy-import button | Migration requirement: on-demand conversion of old conversations | MEDIUM | Reads `conversation_messages`/`stream_events` → writes JSONL threads; old tables frozen, not dropped. |

### Differentiators (Competitive Advantage)

These align with Railyin's Core Value — the board + task-card workflow with decision-request UX, not generic chat.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Card↔thread integration (board-native chat) | Every task card **is** a conversation (threadId = conversation.id); chat state follows board lifecycle — no other CopilotKit app does this out of the box | MEDIUM | Runner/bridge mapping; sessions = threads without taskId. Keeps board reactivity on `/ws` while chat pushes over the CopilotKit connection. |
| Decision cards as interrupt UI | Structured approve/reject with payload — not a text question; the agent's run genuinely pauses and resumes with the decision | MEDIUM | Interrupt `reason` + rendered card (ported decision UX); `status: resolved/cancelled` + payload in resume. Upgrades existing decision_request without a custom protocol. |
| Domain tool renderers (shell/file/delegate) | Ported renderers as CopilotKit slots: shell output, file changes, delegate task summaries rendered meaningfully instead of raw JSON cards | MEDIUM | Default card covers generic tools; `useRenderTool`/slots for the three domain tools. This is where removed features (file_diff stream etc.) resurface as *rendered results* — trim stays. |
| Five engines behind one AG-UI boundary | One wire protocol, five engine adapters, engine selection per workspace; cross-engine context and prompt refs keep working | MEDIUM/HIGH | The bridge is the single translation path (Claude double-broadcast avoidance disappears). Hardest but most valuable piece — it is the migration's raison d'être. |
| MCP Apps for MCP tools with UI resources (future) | Railyin already has MCP + OAuth registry + discovery; rendering MCP-declared UIs would make MCP tools interactive | HIGH | `@ag-ui/mcp-apps-middleware`, sandboxed iframes, thread-history persistence. Deferred — see anti-features. |

### Anti-Features (Commonly Requested, Often Problematic)

| Feature | Why Requested | Why Problematic | Alternative |
|---------|---------------|-----------------|-------------|
| Frontend tools for board tools (`useFrontendTool`) | "Agent should click the board / update tasks from the browser" | Split execution model: board tools are DB-bound on the server; frontend tools create a second execution path with state-sync hazards — no benefit for a single-user app | Keep all board tools server-side; agents already drive the board through the engine layer |
| Realtime multi-client thread sync (premium `useThreads` WebSockets) | "Chat should feel live" | Premium infra for multi-client consistency; one user, one tab — pure overhead; thread metadata changes are rare | Local state + own thread-index endpoint (we own the JSONL files) |
| Shared state streaming (`StateStreamingMiddleware`) | "Render live tool output in the page" | Pattern targets collaborative docs (agent writes into a doc the user edits); Railyin has no such surface, adds middleware + state schema + token-delta plumbing | Existing `/ws` board events (task.updated, code.ref, lsp) already stream live state |
| Voice input (`transcribe` mode on `CopilotChatInput`) | Shiny; CopilotKit includes it | Desk-bound power tool; adds mic permission + transcription UI surface for ~zero daily use; explicitly out of scope | None |
| A2UI / generative UI in v1 | "Agent could render anything — forms, charts" | Needs component schema registry, renderer library, surface event handling, and persistence semantics; decision cards + tool slots cover 95% of Railyin's real needs | Interrupts + tool slots now; revisit A2UI only if decision forms grow beyond cards |
| MCP Apps in v1 | "MCP tools get UI for free" | iframe sandbox infra, extra middleware, env-staleness persistence gotchas ("previously stored MCP Apps won't load correctly" across envs), scope creep in the migration | Defer to v2; MCP discovery/tools keep working as plain tool calls with default cards |
| Attachments (file/image upload) | ChatGPT/Claude all support it | Engines **already have filesystem access to the worktree** — an attachment is redundant for the primary use case; adds upload endpoint + storage handling | Defer; if engines ever need context blobs/images, `attachments` prop + local endpoint is a contained add |
| Rebuilding trimmed features (usage display, compaction_summary, status/status_chunk, file_diff, code_review, transition_event) | "We had it before" | Deliberate feature trim (PROJECT.md); each is a custom protocol type with no AG-UI equivalent and marginal value vs maintenance | Tool renderers + reasoning card cover the observable parts; drop the rest |
| Mermaid rendering | Legacy nicety | CopilotKit default renderer doesn't do it; custom renderer + sanitizer work for a rare case | Acceptable loss (documented) |

## Feature Dependencies

```
JSONL persistence
    └──requires──> Custom RailyinAgentRunner (extends InMemoryAgentRunner)

Thread mapping (threadId = conversation.id)
    └──requires──> JSONL persistence
        └──requires──> RailyinAgentRunner

AG-UI event bridge (engines → AG-UI events)
    └──requires──> Existing engine adapters (EngineEvent stream)

Tool-call slots (default card + shell/file/delegate renderers)
    └──requires──> Bridge emitting TOOL_CALL_START/ARGS/END/RESULT

HITL decision_request
    └──requires──> Bridge mapping on_interrupt → AG-UI interrupt
        └──requires──> Runner resume handling (RunAgentInput.resume)

Cancel / stop
    └──requires──> Runner stop() → engine abort propagation

Regenerate / retry ──enhances──> Thread replay from JSONL + bridge re-run

Legacy import
    └──requires──> JSONL persistence + old-table read path

Reasoning display
    └──requires──> Bridge routing engine thinking → REASONING_* events

useThreads listing ──conflicts──> self-hosted minimal infra (use own index endpoint)

Frontend tools ──conflicts──> server-side tool execution model

A2UI / MCP Apps ──conflicts──> v1 scope (schema/iframe/persistence infra)
```

### Dependency Notes

- **Everything hinges on the RailyinAgentRunner**: persistence, thread mapping, interrupts, cancel, regenerate all flow through it — it should be the first thing built and the most heavily tested (this is why PROJECT.md scopes it ~250 L + ~150 L persistence).
- **Tool-call slots require the bridge to emit complete TOOL_CALL lifecycle events** (start/args/end/result). Engines that batch tool results need synthetic result events on replay (documented runner pattern) or replayed cards show stale "running" state.
- **Regenerate enhances thread replay**: free once JSONL replay exists — strong argument for shipping regenerate right after persistence rather than deferring it.
- **HITL is isolated**: decision_request ↔ interrupt/resume is a self-contained bridge mapping that does not depend on tool slots or reasoning display.
- **Conflicts**: frontend tools and realtime sync are architectural non-goals (split execution / premium infra), not sequencing decisions — mark them "not planned" in requirements so they never get proposed in a phase.

## MVP Definition

### Launch With (v1)

Mirrors PROJECT.md Active requirements — feature-complete for migration parity, not more:

- [ ] AG-UI as wire protocol replacing the custom `StreamEvent` protocol (streaming text, reasoning, tool calls)
- [ ] `RailyinAgentRunner` (run/connect/stop/isRunning) bridging all five engines
- [ ] JSONL per-thread storage (`data/threads/{threadId}.jsonl`)
- [ ] Thread mapping (conversation.id = threadId; sessions = threads without taskId)
- [ ] Legacy-import button (old tables frozen, not dropped)
- [ ] decision_request via `on_interrupt` + resume (run pauses, resumes with decision)
- [ ] Tool-call slots: default card (useDefaultRenderTool) + ported shell/file/delegate renderers
- [ ] CopilotRuntime mounted in Bun.serve via hono handler (single server)
- [ ] Board `/ws` reactivity preserved (task.updated, code.ref, lsp) alongside chat over CopilotKit connection

### Add After Validation (v1.x)

- [ ] Regenerate / retry — verify Vue v2 API first; else implement via JSONL replay (cheap once persistence exists). Trigger: first "how do I redo that" moment.
- [ ] Cancel hardening — per-engine abort verification; label partial responses "stopped". Trigger: users complain a stop didn't stop the engine.
- [ ] Suggestions (`useConfigureSuggestions`) — cheap, contextual prompts. Trigger: wanting a lighter alternative to typing slash commands.
- [ ] Thread list niceties (rename/archive/delete via own index endpoint). Trigger: thread count grows past ~20.
- [ ] Attachments (images/context blobs) — contained add via `attachments` prop + local upload endpoint. Trigger: an engine asks for visual context.

### Future Consideration (v2+)

- [ ] A2UI generative UI — decision forms, structured input from the agent. Trigger: decision cards hit their expressiveness ceiling.
- [ ] MCP Apps — interactive MCP tool UIs. Trigger: MCP tools with UI resources show up in the registry and default cards feel insufficient.
- [ ] Long-thread virtualization — full-history replay accepted for v1. Trigger: replay cost becomes visible on very long card conversations.
- [ ] Mermaid rendering — trigger: diagrams in card conversations become a real ask.
- [ ] Multi-client thread sync — only if the product ever becomes multi-user (not a local-first feature).

## Feature Prioritization Matrix

| Feature | User Value | Implementation Cost | Priority |
|---------|------------|---------------------|----------|
| Streaming chat (AG-UI events) | HIGH | LOW (stack) | P1 |
| Markdown + code rendering | HIGH | LOW (verify quality) | P1 |
| Tool-call default card | HIGH | LOW (stack) | P1 |
| JSONL persistence (runner) | HIGH | HIGH | P1 |
| Thread mapping + listing | HIGH | MEDIUM | P1 |
| decision_request interrupt/resume | HIGH (core value) | MEDIUM | P1 |
| Engine bridge (5 engines → AG-UI) | HIGH | HIGH | P1 |
| Legacy import | MEDIUM | MEDIUM | P1 |
| Slash commands / prompt refs parity | HIGH (regression) | MEDIUM | P1 |
| Cancel/stop | HIGH | MEDIUM | P1 |
| Reasoning display | MEDIUM | LOW (zero-config) | P1 |
| Tool slots: shell/file/delegate renderers | HIGH (domain) | MEDIUM | P1 |
| Regenerate/retry | MEDIUM | MEDIUM | P2 |
| Suggestions | LOW | LOW | P2/P3 |
| Attachments | LOW | MEDIUM | P3 |
| A2UI / MCP Apps | LOW (now) | HIGH | P3+ |
| Frontend tools / shared state | — | — | Not planned |
| Realtime multi-client sync | — | — | Not planned |

**Priority key:** P1 = launch with (migration parity + core value), P2 = soon after, P3 = later, "Not planned" = anti-features (record as non-goals).

## Competitor Feature Analysis

| Feature | ChatGPT / Claude | Cursor / Codex | CopilotKit Defaults | Railyin Approach |
|---------|------------------|----------------|---------------------|------------------|
| Streaming | Token + cursor | Token + status phases | Token + cursor | AG-UI text events via bridge (same as CopilotKit) |
| Markdown | Stable-layout, block-level commit | Same + code regions | Default renderer (verify) | Default renderer + slot overrides if needed |
| Tool calls | Interleaved cards | Interleaved cards + activity panel | Expandable default card | Default card + ported shell/file/delegate slots |
| HITL | Inline approvals (Claude Code: permission prompts) | Approval gates | Interrupts via AG-UI | decision_request → interrupt/resume with payload |
| Thinking display | Collapsible, with timer | Collapsible | Zero-config reasoning card | Zero-config card (pi thinking already flows) |
| Regenerate | Yes | Yes | Not confirmed in Vue v2 — verify | JSONL replay + re-run (fallback) |
| Threads | Cloud-synced | Session-based | Runner-managed | JSONL files owned by Railyin |
| Attachments | Images/files | File refs | `attachments` prop | Not in v1 (engines own the filesystem) |
| Generative UI | Limited | Rich (diffs, widgets) | A2UI + MCP Apps + tool slots | Tool slots v1; A2UI/MCP Apps v2+ |

## Sources

- AG-UI protocol docs & SDK reference (github.com/ag-ui-protocol/ag-ui — docs/concepts/*, integrations READMEs) via Context7 — MEDIUM
- CopilotKit docs (docs.copilotkit.ai — components, hooks, backend/agent-runner, custom-agent, generative-ui/reasoning, multimodal-attachments, premium/threads-explained, MCP Apps) via Context7 — MEDIUM
- CopilotKit MCP Apps showcase + landing (docs.showcase.copilotkit.ai, copilotkit.ai/mcp-apps, github.com/CopilotKit/CopilotKit examples/showcases/mcp-apps) — MEDIUM
- AYDesign "AI streaming response UI design patterns 2026"; Zylos Research "Agentic UX: Frontend Design Patterns for AI Agents 2026"; Agentic Forge streaming tool-call article; bobkov.dev agentic UI article; agentic-tui PyPI description — LOW/MEDIUM (cross-checked, consistent 2026 baseline)
- Microsoft 365 Copilot MCP Apps announcement (devblogs.microsoft.com, 2026-04-07) — LOW (corroborating)

**Verification flags for the phase:**
1. CopilotKit Vue v2: regenerate API — unconfirmed (Context7 docs didn't surface it) — verify against pinned version before committing to implementation.
2. `useThreads` on self-hosted runtime — known risk; prototype the own-index fallback early.
3. Engine abort semantics (cancel) differ per engine SDK — spike stop() behavior for all five adapters before wiring UI.
4. CopilotKit Vue is early-access — pin exact versions and wrap all usage in thin local components so the swap surface stays small.

---
*Feature research for: Railyin AG-UI + CopilotKit chat stack migration*
*Researched: 2026-08-08*
