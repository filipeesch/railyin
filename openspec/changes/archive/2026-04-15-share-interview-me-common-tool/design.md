## Context

The interview_me interaction is intended to be a first-class high-stakes decision tool, but the current implementation is split between shared and engine-specific code paths. Copilot registers interview_me through a dedicated local tool object and callback, while shared common tool infrastructure already contains interview-related display/event assumptions. This split increases drift risk, forces duplicated schema maintenance, and makes cross-engine parity harder to guarantee.

The target state is a single shared registration and execution contract for interview_me, with identical schema semantics and suspension behavior across native, Copilot, and Claude engines.

## Goals / Non-Goals

**Goals:**
- Make interview_me part of the shared common tool registry used by all engines.
- Use the richer interview_me description and JSON schema currently defined in workflow tools as canonical source content.
- Remove Copilot-only interview tool registration.
- Ensure all engines can suspend execution and emit interview_me prompt events through a common context callback contract.
- Preserve existing interview prompt persistence and waiting_user lifecycle behavior in orchestrator.

**Non-Goals:**
- Redesigning interview UI payload shape or frontend rendering.
- Changing ask_me behavior or schema.
- Introducing backward-compatibility shims for old interview tool registration paths.
- Altering board/task/todo common tool behavior outside interview_me integration.

## Decisions

### 1. Canonicalize interview_me definition in shared common tools
The interview_me tool definition will be added to shared common tool definitions and its description/schema content will match the richer definition currently used in workflow tools.

Rationale:
- Eliminates duplicate tool metadata that currently diverges by engine.
- Ensures the same prompt instructions and parameter shape regardless of engine.

Alternatives considered:
- Keep Copilot-local registration and copy updates manually: rejected due to ongoing drift risk.
- Keep workflow-only definition and special-case engine adapters: rejected because it preserves duplicate integration complexity.

### 2. Extend CommonToolContext with interview suspension callback
Common tool execution will receive an optional onInterviewMe callback in CommonToolContext. executeCommonTool handles interview_me by serializing payload and invoking this callback.

Rationale:
- Keeps interview suspension semantics in one execution path.
- Avoids per-engine custom tool handlers that bypass shared execution logic.

Alternatives considered:
- Emit interview events directly from executeCommonTool: rejected because event emission belongs to engine runtime, not pure common tool module.

### 3. Remove Copilot-exclusive interview tool registration
Copilot tool registration will map COMMON_TOOL_DEFINITIONS only; custom interviewTool assembly is removed.

Rationale:
- Enforces one source of tool registration truth.
- Reduces engine-specific branching and maintenance cost.

Alternatives considered:
- Keep both shared and local interview registrations temporarily: rejected because no backward compatibility is required and dual-path behavior is error-prone.

### 4. Add Claude interview suspension parity
Claude engine runtime will wire onInterviewMe in commonToolContext so interview_me can trigger suspension and emit interview_me engine events consistently with Copilot/native behavior.

Rationale:
- Shared registration without shared suspension semantics would produce incorrect run continuation in Claude.
- Cross-engine parity is required by this change scope.

Alternatives considered:
- Register interview_me for Copilot only: rejected because requirement is shared across all engines.

## Risks / Trade-offs

- [Risk] Claude run-loop interruption around interview callback may race with in-flight SDK events.
  - Mitigation: trigger interview callback and deterministic loop stop in adapter runtime, then rely on existing orchestrator waiting_user transition logic.

- [Risk] Schema mismatch between workflow tool definition and new common definition could regress prompt quality.
  - Mitigation: copy canonical description/schema content verbatim from workflow definition and add targeted validation tests.

- [Risk] Introducing interview_me into common tool list affects any engine adapter consuming all common tools.
  - Mitigation: ensure each engine context supplies onInterviewMe and add graceful error text when callback is absent.

- [Trade-off] Shared callback contract slightly broadens CommonToolContext API surface.
  - Mitigation: keep callback optional and scoped to interview_me only.

## Migration Plan

1. Add interview_me definition to shared common tool definitions using canonical schema text.
2. Extend CommonToolContext with optional onInterviewMe callback.
3. Implement interview_me branch in executeCommonTool that invokes callback and returns suspension sentinel text.
4. Remove Copilot-specific interview tool registration and pass callback via context from Copilot engine.
5. Wire Claude adapter/engine context to support interview callback, emit interview_me event, and stop active run turn.
6. Keep workflow tool definition behavior aligned with shared canonical content.
7. Run validation and tests for tool registration and waiting_user transitions.

Rollback strategy:
- Revert change commit to restore previous Copilot-local registration and shared-tool exclusion.
- Since no DB schema changes are involved, rollback is code-only.

## Open Questions

- Should workflow TOOL_DEFINITIONS keep a separate interview_me entry after shared canonicalization, or should workflow import the shared interview definition to avoid future drift entirely?
- Should executeCommonTool return a hard error when onInterviewMe is missing, or a soft error string to avoid fatal execution termination?
