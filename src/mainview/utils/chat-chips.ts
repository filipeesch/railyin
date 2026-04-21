/**
 * Utilities for parsing chip tokens in the chat editor document.
 *
 * Chip syntax:
 *   [#path/to/file.ts|file.ts]        — file reference
 *   [#path/to/file.ts:L10-L25|Symbol] — symbol reference with line range
 *   [@server:tool|toolName]            — MCP tool reference
 *   [/command-name|command-name]       — slash command reference
 */

import type { Attachment } from "@shared/rpc-types";

export const CHIP_PATTERN = /\[([#@/][^\]|]+)\|([^\]]+)\]/g;

export interface ParsedChip {
  raw: string;
  ref: string;
  label: string;
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

export interface ExtractResult {
  humanText: string;
  attachments: Attachment[];
}

/**
 * Given raw document text (with chip tokens), replace chips with
 * human-readable labels and build the attachment list.
 */
export function extractChips(doc: string): ExtractResult {
  const chips = parseChips(doc);
  let humanText = doc;
  const attachments: Attachment[] = [];

  for (const chip of chips) {
    humanText = humanText.replace(chip.raw, chip.label);
    if (chip.ref.startsWith("#")) {
      // Preserve ":L10-L25" line range so the backend can inject a scoped snippet (task 9.3)
      const fileRef = chip.ref.slice(1);
      attachments.push({
        label: chip.label,
        mediaType: "text/plain",
        data: `@file:${fileRef}`,
      });
    }
    // @ chips (MCP tools) are rendered as plain text — no attachment needed
  }

  return { humanText: humanText.trim(), attachments };
}
