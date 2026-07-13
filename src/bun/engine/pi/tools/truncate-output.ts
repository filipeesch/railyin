/**
 * Head+tail truncation for shell command output.
 *
 * Keeps the beginning and the end of long output (rather than only the
 * beginning) so the model can see both the initial context (e.g. what
 * command started running) and the final result (e.g. pass/fail summary,
 * final error), which a head-only truncation would otherwise cut off.
 */

export interface TruncateResult {
  text: string;
  truncated: boolean;
}

/**
 * Returns `text` unmodified if it fits within `headBytes + tailBytes`.
 * Otherwise returns the first `headBytes` characters, a marker noting how
 * many characters were omitted, and the last `tailBytes` characters.
 *
 * Note: budgets are measured in UTF-16 code units (`string.length`), matching
 * the previous implementation's `slice()`-based truncation.
 */
export function truncateHeadTail(text: string, headBytes: number, tailBytes: number): TruncateResult {
  const limit = headBytes + tailBytes;
  if (text.length <= limit) {
    return { text, truncated: false };
  }

  const head = text.slice(0, headBytes);
  const tail = text.slice(text.length - tailBytes);
  const omitted = text.length - headBytes - tailBytes;

  return {
    text: `${head}\n[... ${omitted} characters omitted ...]\n${tail}`,
    truncated: true,
  };
}
