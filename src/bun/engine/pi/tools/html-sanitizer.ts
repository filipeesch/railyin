/**
 * HTML sanitization and markdown conversion utilities.
 *
 * Used by browser_search, browser_extract, and fetch_url to clean
 * HTML responses before returning them to the agent.
 */

// ─── HTML Sanitizer ──────────────────────────────────────────────────────────

/**
 * Strip non-content elements from HTML while preserving content tags and links.
 *
 * Removes:
 * - <script> and <style> blocks entirely
 * - <head>, <meta>, <link>, <title>, <base>, <noscript>
 * - HTML comments
 * - <nav>, <footer>, <header> (usually not useful content)
 *
 * Preserves:
 * - Content tags: <a>, <p>, <div>, <span>, <h1>–<h6>, <li>, <tr>, <td>, <th>,
 *   <blockquote>, <pre>, <code>, <strong>, <em>, <b>, <i>, <u>, <table>, <ul>, <ol>
 * - Link URLs (href attributes)
 *
 * Collapses excessive whitespace and decodes common HTML entities.
 */
export function sanitizeHtml(html: string): string {
  let text = html;

  // Remove script blocks entirely
  text = text.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "");

  // Remove style blocks entirely
  text = text.replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");

  // Remove HTML comments
  text = text.replace(/<!--[\s\S]*?-->/g, "");

  // Remove head section entirely
  text = text.replace(/<head\b[^>]*>[\s\S]*?<\/head>/gi, "");

  // Remove individual non-content tags
  const removeTags = [
    "meta", "link", "title", "base", "noscript",
    "nav", "footer", "header",
    "iframe", "object", "embed", "source", "track",
    "form", "input", "button", "select", "textarea", "label",
    "img", "svg", "canvas", "video", "audio", "picture",
  ];
  for (const tag of removeTags) {
    text = text.replace(new RegExp(`<${tag}\\b[^>]*>`, "gi"), "");
    text = text.replace(new RegExp(`</${tag}\\b[^>]*>`, "gi"), "");
  }

  // Replace block-level closing tags with newlines for readability
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|article|section|main|table|ul|ol)[^>]*>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Strip remaining tags but preserve link URLs
  text = text.replace(/<a\b([^>]*)>([^<]*)<\/a>/gi, (_m, attrs, inner) => {
    const hrefMatch = attrs.match(/href=["']([^"']*)["']/i);
    const url = hrefMatch ? hrefMatch[1] : "";
    return inner + (url ? ` (${url})` : "");
  });
  text = text.replace(/<[^>]+>/g, "");

  // Decode common HTML entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&mdash;/g, "—")
    .replace(/&ndash;/g, "–")
    .replace(/&hellip;/g, "…")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)));

  // Collapse whitespace
  text = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
}

// ─── HTML to Markdown ────────────────────────────────────────────────────────

/**
 * Convert sanitized HTML to readable markdown.
 * This is a lightweight converter suitable for search results and page extraction.
 * Not a full HTML-to-markdown converter — focuses on readability for the LLM.
 */
export function htmlToMarkdown(html: string): string {
  let text = html;

  // Headings
  text = text.replace(/<h1\b[^>]*>([^<]*)<\/h1>/gi, "\n\n# $1\n\n");
  text = text.replace(/<h2\b[^>]*>([^<]*)<\/h2>/gi, "\n\n## $1\n\n");
  text = text.replace(/<h3\b[^>]*>([^<]*)<\/h3>/gi, "\n\n### $1\n\n");
  text = text.replace(/<h4\b[^>]*>([^<]*)<\/h4>/gi, "\n\n#### $1\n\n");
  text = text.replace(/<h5\b[^>]*>([^<]*)<\/h5>/gi, "\n\n##### $1\n\n");
  text = text.replace(/<h6\b[^>]*>([^<]*)<\/h6>/gi, "\n\n###### $1\n\n");

  // Links
  text = text.replace(/<a\b([^>]*)>([^<]*)<\/a>/gi, (_m, attrs, inner) => {
    const hrefMatch = attrs.match(/href=["']([^"']*)["']/i);
    const url = hrefMatch ? hrefMatch[1] : "";
    const linkText = inner.trim();
    return url ? `[${linkText}](${url})` : linkText;
  });

  // Bold and italic
  text = text.replace(/<(strong|b)\b[^>]*>([^<]*)<\/\1>/gi, "**$2**");
  text = text.replace(/<(em|i)\b[^>]*>([^<]*)<\/\1>/gi, "*$2*");

  // Code
  text = text.replace(/<code\b[^>]*>([^<]*)<\/code>/gi, "`$1`");
  text = text.replace(/<pre\b[^>]*>([\s\S]*?)<\/pre>/gi, "\n\n```\n$1\n```\n\n");

  // Lists
  text = text.replace(/<li\b[^>]*>([^<]*)<\/li>/gi, "\n- $1");
  text = text.replace(/<\/?(ul|ol)\b[^>]*>/gi, "");

  // Paragraphs and block elements
  text = text.replace(/<\/(p|div|blockquote|article|section|main|tr)[^>]*>/gi, "\n\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");

  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");

  // Decode entities
  text = text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");

  // Collapse whitespace
  text = text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ");
  text = text.replace(/\n{3,}/g, "\n\n").trim();

  return text;
}
