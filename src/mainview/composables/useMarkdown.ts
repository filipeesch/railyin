import { marked } from "marked";

export function useMarkdown() {
    function renderMd(content: string): string {
        return marked.parse(content, { async: false, breaks: true, gfm: true }) as string;
    }
    return { renderMd };
}
