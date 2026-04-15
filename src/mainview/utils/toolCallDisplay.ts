import type { ToolCallDisplay } from "@shared/rpc-types";

export function parseToolCallDisplay(content: string): ToolCallDisplay | undefined {
    try {
        const parsed = JSON.parse(content) as { display?: ToolCallDisplay };
        return parsed.display;
    } catch {
        return undefined;
    }
}

export function formatToolSubject(subject: string, maxLen = 80): string {
    if (subject.length <= maxLen) return subject;
    const head = 45;
    const tail = Math.max(0, maxLen - head - 1);
    return subject.slice(0, head) + "…" + subject.slice(-tail);
}
