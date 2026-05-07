import { computed, type Ref } from "vue";

export interface ToolResultDisplayInput {
  result?: string | null;
  contentType?: string | null;
}

/**
 * Resolves the best display text for a tool result.
 * For file content tools: use the raw content field (actual file text), not a summary.
 * For other tools: priority is detailedContent → contents[].text → content → raw
 */
export function useToolResultDisplay(input: Ref<ToolResultDisplayInput>) {
  const displayText = computed<string>(() => {
    const raw = input.value.result;
    if (!raw) return "";
    try {
      const parsed = JSON.parse(raw);
      const isFile = input.value.contentType === "file";
      // For file tools, skip detailedContent (summary) and return actual file text
      if (!isFile && parsed.detailedContent && typeof parsed.detailedContent === "string") {
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
