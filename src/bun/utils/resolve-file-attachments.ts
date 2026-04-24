import type { Attachment } from "../../shared/rpc-types.ts";

const MAX_BYTES = 100 * 1024; // 100 KB cap per attachment

/**
 * Parse an @file: data URI into its components.
 * Supports:
 *   @file:src/foo.ts              → { path: "src/foo.ts" }
 *   @file:src/foo.ts:L10-L25     → { path: "src/foo.ts", startLine: 10, endLine: 25 }
 */
export function parseFileRef(data: string): { path: string; startLine?: number; endLine?: number } | null {
  if (!data.startsWith("@file:")) return null;
  const ref = data.slice("@file:".length);
  const lineRangeMatch = /:L(\d+)-L(\d+)$/.exec(ref);
  if (lineRangeMatch) {
    return {
      path: ref.slice(0, lineRangeMatch.index),
      startLine: Number(lineRangeMatch[1]),
      endLine: Number(lineRangeMatch[2]),
    };
  }
  return { path: ref };
}

/**
 * Resolve all @file: attachments in a message and append them to the prompt content.
 *
 * - Files that exist: injected as fenced code blocks (with line range header if scoped).
 * - Files that don't exist (9.6): a soft notice is injected, the message continues sending.
 * - Content > 100 KB is truncated with a trailing notice.
 *
 * Returns the augmented content string.
 */
export async function resolveFileAttachments(content: string, attachments: Attachment[]): Promise<string> {
  const fileAttachments = attachments.filter((a) => a.data.startsWith("@file:"));
  if (fileAttachments.length === 0) return content;

  const blocks: string[] = [];

  for (const att of fileAttachments) {
    const parsed = parseFileRef(att.data);
    if (!parsed) continue;

    const { path, startLine, endLine } = parsed;

    let text: string;
    try {
      const raw = await Bun.file(path).text();
      if (startLine !== undefined && endLine !== undefined) {
        const lines = raw.split("\n");
        const sliced = lines.slice(startLine - 1, endLine);
        text = sliced.join("\n");
      } else {
        text = raw;
      }
    } catch {
      // 9.6 — file not found: inject soft notice and continue
      blocks.push(`[File \`${path}\` not found — skipped]`);
      continue;
    }

    // Cap at 100 KB
    let truncated = false;
    if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
      text = Buffer.from(text, "utf8").slice(0, MAX_BYTES).toString("utf8");
      // Trim to last complete line to avoid broken multibyte chars
      const lastNewline = text.lastIndexOf("\n");
      if (lastNewline > 0) text = text.slice(0, lastNewline);
      truncated = true;
    }

    // 9.3 — fenced code block with path header
    const ext = path.split(".").pop() ?? "";
    const rangeLabel = startLine !== undefined ? ` (lines ${startLine}–${endLine})` : "";
    const header = `// ${path}${rangeLabel}`;
    const block = `\`\`\`${ext}\n${header}\n${text}${truncated ? "\n// [truncated at 100 KB]" : ""}\n\`\`\``;
    blocks.push(block);
  }

  if (blocks.length === 0) return content;
  return `${content}\n\n${blocks.join("\n\n")}`;
}
