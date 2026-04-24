/**
 * Utilities for parsing chip tokens in the chat editor document.
 *
 * Chip syntax:
 *   [#path/to/file.ts|#file.ts]        — file reference
 *   [#path/to/file.ts:L10-L25|#Symbol] — symbol reference with line range
 *   [@server:tool|@toolName]           — MCP tool reference
 *   [/command-name|/command-name]      — slash command reference
 */

import type { Attachment } from "@shared/rpc-types";

export const CHIP_PATTERN = /\[([#@/][^\]|]+)\|([^\]]+)\]/g;

export interface ParsedChip {
  raw: string;
  ref: string;
  label: string;
}

export type ChipKind = "file" | "tool" | "slash";

export type ChipSegment =
  | { type: "text"; text: string }
  | { type: "chip"; chip: ParsedChip; label: string; kind: ChipKind };

function chipSigil(ref: string): "#" | "@" | "/" {
  return ref[0] as "#" | "@" | "/";
}

export function chipVisibleLabel(chip: Pick<ParsedChip, "ref" | "label">): string {
  const sigil = chipSigil(chip.ref);
  return chip.label.startsWith(sigil) ? chip.label : `${sigil}${chip.label}`;
}

export function chipAttachmentLabel(chip: Pick<ParsedChip, "ref" | "label">): string {
  const visibleLabel = chipVisibleLabel(chip);
  return chip.ref.startsWith("#") ? visibleLabel.slice(1) : visibleLabel;
}

export function chipKind(chip: Pick<ParsedChip, "ref">): ChipKind {
  if (chip.ref.startsWith("#")) return "file";
  if (chip.ref.startsWith("@")) return "tool";
  return "slash";
}

/**
 * Parse all chip tokens from a document string.
 */
export function parseChips(doc: string): ParsedChip[] {
  CHIP_PATTERN.lastIndex = 0;
  const chips: ParsedChip[] = [];
  let m: RegExpExecArray | null;
  while ((m = CHIP_PATTERN.exec(doc)) !== null) {
    chips.push({ raw: m[0], ref: m[1], label: m[2] });
  }
  return chips;
}

export function segmentChipText(doc: string): ChipSegment[] {
  CHIP_PATTERN.lastIndex = 0;
  const segments: ChipSegment[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = CHIP_PATTERN.exec(doc)) !== null) {
    if (match.index > cursor) {
      segments.push({ type: "text", text: doc.slice(cursor, match.index) });
    }
    const chip: ParsedChip = { raw: match[0], ref: match[1], label: match[2] };
    segments.push({
      type: "chip",
      chip,
      label: chipVisibleLabel(chip),
      kind: chipKind(chip),
    });
    cursor = match.index + match[0].length;
  }

  if (cursor < doc.length) {
    segments.push({ type: "text", text: doc.slice(cursor) });
  }

  return segments;
}

export interface ExtractResult {
  humanText: string;
  attachments: Attachment[];
}

function chipEngineText(chip: Pick<ParsedChip, "ref" | "label">): string {
  return chip.ref.startsWith("#")
    ? chipAttachmentLabel(chip)
    : chipVisibleLabel(chip);
}

function isTokenChar(char: string | undefined): boolean {
  return char != null && /[A-Za-z0-9_./:@#-]/.test(char);
}

function appendEnginePiece(parts: string[], piece: string): void {
  if (!piece) return;
  const previous = parts[parts.length - 1];
  if (previous) {
    const prevChar = previous.at(-1);
    const nextChar = piece[0];
    if (isTokenChar(prevChar) && isTokenChar(nextChar)) {
      parts.push(" ");
    }
  }
  parts.push(piece);
}

/**
 * Given raw document text (with chip tokens), replace chips with
 * human-readable labels and build the attachment list.
 */
export function extractChips(doc: string): ExtractResult {
  const segments = segmentChipText(doc);
  const attachments: Attachment[] = [];
  const parts: string[] = [];

  for (const segment of segments) {
    if (segment.type === "text") {
      appendEnginePiece(parts, segment.text);
      continue;
    }

    const chip = segment.chip;
    appendEnginePiece(parts, chipEngineText(chip));
    if (chip.ref.startsWith("#")) {
      // Preserve ":L10-L25" line range so the backend can inject a scoped snippet (task 9.3)
      const fileRef = chip.ref.slice(1);
      attachments.push({
        label: chipAttachmentLabel(chip),
        mediaType: "text/plain",
        data: `@file:${fileRef}`,
      });
    }
    // @ chips (MCP tools) are rendered as plain text — no attachment needed
  }

  return { humanText: parts.join("").trim(), attachments };
}
