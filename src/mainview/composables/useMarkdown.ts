import { marked } from "marked";

const CHIP_RE = /\[([#@/][^\]|]+)\|([^\]]+)\]/g;

function chipHtml(ref: string, label: string): string {
    const kind = ref.startsWith("#") ? "file" : ref.startsWith("@") ? "tool" : "slash";
    const sigil = ref[0];
    const visibleLabel = label.startsWith(sigil) ? label : `${sigil}${label}`;
    const escaped = visibleLabel.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<span class="inline-chip-text__chip msg__chip inline-chip-text__chip--${kind} msg__chip--${kind}">${escaped}</span>`;
}

export function useMarkdown() {
    function renderMd(content: string): string {
        return marked.parse(content, { async: false, breaks: true, gfm: true }) as string;
    }

    /** Like renderMd but also renders chip tokens ([#path|label], [@srv:tool|@name], [/cmd|/cmd]). */
    function renderUserMd(content: string): string {
        const withChips = content.replace(CHIP_RE, (_, ref: string, label: string) => chipHtml(ref, label));
        return marked.parse(withChips, { async: false, breaks: true, gfm: true }) as string;
    }

    return { renderMd, renderUserMd };
}
