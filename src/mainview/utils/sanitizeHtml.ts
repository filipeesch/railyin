/**
 * sanitizeHtml.ts — shared HTML sanitizer for v-html injection sites.
 *
 * CR-01 (Phase 5 review): marked.parse() passes raw HTML through verbatim,
 * so agent/tool-controlled markdown (interrupt context/question/descriptions,
 * subagent prompt/result, chat messages, notes…) can embed
 * `<img onerror=…>` / `<iframe srcdoc=…>` payloads that execute on render.
 * Every v-html site must route its rendered markdown through sanitizeHtml
 * before injection.
 *
 * DOMPurify defaults keep the standard markdown output (p, pre/code, lists,
 * tables, a[href], img, blockquote…) while stripping script/event handlers,
 * javascript: URLs, and unknown tags. The mermaid `<pre class="mermaid">`
 * pass-through survives (mermaid's own strict security level sanitizes the
 * diagram markup it renders).
 *
 * No-DOM fallback: DOMPurify 3.4+ exports a factory (no `sanitize` method)
 * outside a browser. Railyin only renders v-html in the browser, so node-side
 * callers (unit tests) get the input back unchanged — mirroring DOMPurify's
 * own `!isSupported → return dirty` behavior.
 */
import DOMPurify from "dompurify";

const purify = typeof DOMPurify.sanitize === "function" ? DOMPurify : DOMPurify(window);

export function sanitizeHtml(html: string): string {
  if (typeof purify.sanitize !== "function") return html;
  return purify.sanitize(html);
}
