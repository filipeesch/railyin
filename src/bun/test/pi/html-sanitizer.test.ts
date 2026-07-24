import { describe, test, expect } from "bun:test";
import { sanitizeHtml, htmlToMarkdown } from "../../engine/pi/tools/html-sanitizer.ts";

describe("sanitizeHtml", () => {
  test("HS-1: removes <script> and <style> blocks entirely", () => {
    const html = `<div>
      <script>alert('xss')</script>
      <p>Content</p>
      <style>body { color: red; }</style>
    </div>`;
    const result = sanitizeHtml(html);
    expect(result).not.toContain("script");
    expect(result).not.toContain("alert");
    expect(result).not.toContain("style");
    expect(result).not.toContain("color: red");
    expect(result).toContain("Content");
  });

  test("HS-2: removes <head>, <meta>, <link>, and HTML comments", () => {
    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Page Title</title>
  <link rel="stylesheet" href="style.css">
</head>
<body>
  <!-- This is a comment -->
  <p>Visible content</p>
</body>
</html>`;
    const result = sanitizeHtml(html);
    expect(result).not.toContain("<head>");
    expect(result).not.toContain("<meta");
    expect(result).not.toContain("<title>");
    expect(result).not.toContain("<link");
    expect(result).not.toContain("This is a comment");
    expect(result).toContain("Visible content");
  });

  test("HS-3: preserves content tags and links", () => {
    const html = `<h1>Title</h1>
<p>Paragraph with <a href="https://example.com">a link</a>.</p>
<ul><li>Item 1</li><li>Item 2</li></ul>`;
    const result = sanitizeHtml(html);
    expect(result).toContain("Title");
    expect(result).toContain("Paragraph with");
    expect(result).toContain("a link");
    expect(result).toContain("https://example.com");
    expect(result).toContain("Item 1");
    expect(result).toContain("Item 2");
  });

  test("HS-4: collapses whitespace and decodes common HTML entities", () => {
    const html = `<p>  Lots   of   spaces  </p>
<p>&amp; &lt; &gt; &quot; &#39; &nbsp; &mdash;</p>`;
    const result = sanitizeHtml(html);
    expect(result).not.toContain("  "); // no double spaces
    expect(result).toContain("&");
    expect(result).toContain("<");
    expect(result).toContain(">");
    expect(result).toContain('"');
    expect(result).toContain("'");
  });

  test("HS-5: handles nested and mixed content", () => {
    const html = `<div class="container">
  <nav><a href="/home">Home</a></nav>
  <main>
    <article>
      <h2>Article Title</h2>
      <p>Some <strong>bold</strong> and <em>italic</em> text.</p>
      <script>var x = 1;</script>
    </article>
    <footer>Footer content</footer>
  </main>
</div>`;
    const result = sanitizeHtml(html);
    expect(result).toContain("Article Title");
    expect(result).toContain("bold");
    expect(result).toContain("italic");
    expect(result).not.toContain("var x = 1");
    // nav and footer tags are removed but their text content may remain
    expect(result).toContain("Home");
  });
});

describe("htmlToMarkdown", () => {
  test("HS-5: produces readable markdown from HTML", () => {
    const html = `<h1>Main Title</h1>
<p>A paragraph with <a href="https://example.com">a link</a>.</p>
<h2>Section</h2>
<p>Text with <strong>bold</strong> and <em>italic</em>.</p>
<ul>
  <li>Item one</li>
  <li>Item two</li>
</ul>
<pre><code>const x = 1;</code></pre>`;
    const result = htmlToMarkdown(html);
    expect(result).toContain("# Main Title");
    expect(result).toContain("## Section");
    expect(result).toContain("[a link](https://example.com)");
    expect(result).toContain("**bold**");
    expect(result).toContain("*italic*");
    expect(result).toContain("- Item one");
    expect(result).toContain("- Item two");
    expect(result).toContain("```");
    expect(result).toContain("const x = 1;");
  });

  test("handles entities in markdown output", () => {
    const html = `<p>&lt;code&gt; &amp; &quot;quotes&quot;</p>`;
    const result = htmlToMarkdown(html);
    expect(result).toContain("<code>");
    expect(result).toContain("&");
    expect(result).toContain('"quotes"');
  });
});
