import type { TransitionEventMetadata } from "@shared/rpc-types";
import { segmentChipText, type ChipSegment } from "./chat-chips";

function asNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export function normalizeTransitionEventMetadata(value: unknown): TransitionEventMetadata | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const raw = value as Record<string, unknown>;
  const from = asNonEmptyString(raw.from);
  const to = asNonEmptyString(raw.to);
  const rawInstruction = raw.instructionDetail;

  if (!from && !to && (!rawInstruction || typeof rawInstruction !== "object")) {
    return null;
  }

  const instruction = rawInstruction && typeof rawInstruction === "object"
    ? rawInstruction as Record<string, unknown>
    : null;
  const displayText = asNonEmptyString(instruction?.displayText);
  const sourceText = asNonEmptyString(instruction?.sourceText);
  const sourceKind = instruction?.sourceKind === "slash" || instruction?.sourceKind === "inline"
    ? instruction.sourceKind
    : null;
  const sourceRef = asNonEmptyString(instruction?.sourceRef);

  return {
    ...(from ? { from } : {}),
    ...(to ? { to } : {}),
    ...(displayText || sourceText || sourceKind || sourceRef
      ? {
        instructionDetail: {
          ...(displayText ? { displayText } : {}),
          ...(sourceText ? { sourceText } : {}),
          ...(sourceKind ? { sourceKind } : {}),
          ...(sourceRef ? { sourceRef } : {}),
        },
      }
      : {}),
  };
}

export function formatTransitionSummary(metadata: TransitionEventMetadata | null): string {
  const toLabel = metadata?.to?.trim() || "?";
  const fromLabel = metadata?.from?.trim();
  return fromLabel ? `Moved to ${toLabel} from ${fromLabel}` : `Moved to ${toLabel}`;
}

export function getTransitionInstructionText(metadata: TransitionEventMetadata | null): string {
  const detail = metadata?.instructionDetail;
  if (!detail) return "";
  if (detail.sourceKind === "slash") {
    return detail.sourceText?.trim() || detail.displayText?.trim() || "";
  }
  return detail.displayText?.trim() || detail.sourceText?.trim() || "";
}

export function getTransitionInstructionSegments(metadata: TransitionEventMetadata | null): ChipSegment[] {
  const text = getTransitionInstructionText(metadata);
  return text ? segmentChipText(text) : [];
}
