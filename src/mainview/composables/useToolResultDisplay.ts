import { computed, type Ref } from "vue";

export interface ToolResultDisplayInput {
  result?: string | null;
  contentType?: string | null;
}

/**
 * Resolves the best display text for a tool result.
 * Priority: detailedContent JSON field → contents[].text → plain content → empty string
 */
export function useToolResultDisplay(input: Ref<ToolResultDisplayInput>) {
  const displayText = computed<string>(() => {
    const raw = input.value.result;
    if (!raw) return "";
    try {
      const parsed = JSON.parse(raw);
      // detailedContent takes priority (human-readable summary)
      if (parsed.detailedContent && typeof parsed.detailedContent === "string") {
        return parsed.detailedContent;
      }
      // contents array (Claude-style)
      if (Array.isArray(parsed.contents)) {
        return parsed.contents
          .filter((c: { type?: string; text?: string }) => c.type === "text" && c.text)
          .map((c: { text: string }) => c.text)
          .join("\n");
      }
      // content string field
      if (parsed.content && typeof parsed.content === "string") {
        return parsed.content;
      }
    } catch {
      // not JSON — use raw
    }
    return raw;
  });

  return { displayText };
}
