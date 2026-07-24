/**
 * Tests for browser automation tools.
 *
 * Uses a fake BrowserSession — no real browser is launched.
 */

import { describe, test, expect } from "bun:test";
import { buildBrowserTools, type BrowserSession, type BrowserSessionFactory } from "../../engine/pi/tools/browser.ts";

// ─── Fake Browser Session ────────────────────────────────────────────────────

class FakeBrowserSession implements BrowserSession {
  currentUrl: string = "";
  readonly pages = new Map<string, string>();
  readonly searchResults = new Map<string, string>();
  private shouldFailNext: "search" | "navigate" | "extract" | null = null;

  constructor() {
    // Default search results
    this.searchResults.set("test query", `
      <html><body>
        <div class="search-result">
          <a href="https://example.com/page1">Result 1</a>
          <p>Snippet for result 1</p>
        </div>
        <div class="search-result">
          <a href="https://example.com/page2">Result 2</a>
          <p>Snippet for result 2</p>
        </div>
      </body></html>
    `);
    // Default page content
    this.pages.set("https://example.com/page1", "<html><body><h1>Page 1 Title</h1><p>Page 1 content here.</p></body></html>");
    this.pages.set("https://example.com/page2", "<html><body><h1>Page 2 Title</h1><p>Page 2 content here.</p></body></html>");
  }

  failNext(action: "search" | "navigate" | "extract"): void {
    this.shouldFailNext = action;
  }

  async searchGoogle(query: string): Promise<string> {
    if (this.shouldFailNext === "search") {
      this.shouldFailNext = null;
      throw new Error("Search failed");
    }
    this.currentUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    return this.searchResults.get(query) ?? `<html><body><p>No results for: ${query}</p></body></html>`;
  }

  async navigate(url: string): Promise<string> {
    if (this.shouldFailNext === "navigate") {
      this.shouldFailNext = null;
      throw new Error("Navigation failed");
    }
    this.currentUrl = url;
    return url;
  }

  async extractContent(): Promise<string> {
    if (this.shouldFailNext === "extract") {
      this.shouldFailNext = null;
      throw new Error("Extraction failed");
    }
    const html = this.pages.get(this.currentUrl) ?? `<html><body><p>Content at ${this.currentUrl}</p></body></html>`;
    // Simple HTML to text conversion for the fake
    let text = html.replace(/<[^>]+>/g, "");
    text = text.replace(/\s+/g, " ").trim();
    return text;
  }

  async close(): Promise<void> {
    // Nothing to clean up
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("buildBrowserTools", () => {
  function makeFactory(session?: FakeBrowserSession): BrowserSessionFactory {
    const s = session ?? new FakeBrowserSession();
    return async () => s;
  }

  test("BT-1: browser_search returns sanitized HTML from the injected fake browser session", async () => {
    const fake = new FakeBrowserSession();
    const { tools, dispose } = buildBrowserTools({ browserFactory: makeFactory(fake) });
    const searchTool = tools.find((t) => t.name === "browser_search")!;

    const result = await searchTool.execute("call-1", { query: "test query" });
    const text = result.content.find((c) => c.type === "text")!.text as string;

    expect(text).toContain("Result 1");
    expect(text).toContain("Result 2");
    expect(text).toContain("https://example.com/page1");

    await dispose();
  });

  test("BT-2: browser_navigate tracks current URL", async () => {
    const fake = new FakeBrowserSession();
    const { tools, dispose } = buildBrowserTools({ browserFactory: makeFactory(fake) });
    const navigateTool = tools.find((t) => t.name === "browser_navigate")!;

    const result = await navigateTool.execute("call-2", { url: "https://example.com/page1" });
    const text = result.content.find((c) => c.type === "text")!.text as string;

    expect(text).toContain("Navigated to:");
    expect(text).toContain("https://example.com/page1");
    expect(result.details?.url).toBe("https://example.com/page1");

    await dispose();
  });

  test("BT-3: browser_extract returns markdown/text from the current page", async () => {
    const fake = new FakeBrowserSession();
    const { tools, dispose } = buildBrowserTools({ browserFactory: makeFactory(fake) });
    const navigateTool = tools.find((t) => t.name === "browser_navigate")!;
    const extractTool = tools.find((t) => t.name === "browser_extract")!;

    // Navigate first
    await navigateTool.execute("call-3a", { url: "https://example.com/page1" });

    // Then extract
    const result = await extractTool.execute("call-3b", {});
    const text = result.content.find((c) => c.type === "text")!.text as string;

    expect(text).toContain("Page 1 Title");
    expect(text).toContain("Page 1 content");

    await dispose();
  });

  test("BT-4: browser session is closed via dispose even when a tool throws", async () => {
    let closed = false;
    const session: BrowserSession = {
      currentUrl: "",
      async searchGoogle() { throw new Error("boom"); },
      async navigate() { return ""; },
      async extractContent() { return ""; },
      async close() { closed = true; },
    };
    const { tools, dispose } = buildBrowserTools({ browserFactory: async () => session });
    const searchTool = tools.find((t) => t.name === "browser_search")!;

    const result = await searchTool.execute("call-4", { query: "fail" });
    const text = result.content.find((c) => c.type === "text")!.text as string;
    expect(text).toContain("Error");
    // Session is shared across tool calls; closed via dispose()
    expect(closed).toBe(false);

    await dispose();
    expect(closed).toBe(true);
  });

  test("BT-5: search/navigation errors surfaced as isError results", async () => {
    const fake = new FakeBrowserSession();
    fake.failNext("search");
    const { tools, dispose } = buildBrowserTools({ browserFactory: makeFactory(fake) });
    const searchTool = tools.find((t) => t.name === "browser_search")!;

    const result = await searchTool.execute("call-5", { query: "fail" });
    const text = result.content.find((c) => c.type === "text")!.text as string;
    expect(text).toContain("Error");

    await dispose();
  });

  test("BT-6: extraction uses the last navigated URL", async () => {
    const fake = new FakeBrowserSession();
    const { tools, dispose } = buildBrowserTools({ browserFactory: makeFactory(fake) });
    const navigateTool = tools.find((t) => t.name === "browser_navigate")!;
    const extractTool = tools.find((t) => t.name === "browser_extract")!;

    // Navigate to page 2
    await navigateTool.execute("call-6a", { url: "https://example.com/page2" });

    // Extract should get page 2 content
    const result = await extractTool.execute("call-6b", {});
    const text = result.content.find((c) => c.type === "text")!.text as string;

    expect(text).toContain("Page 2 Title");
    expect(text).not.toContain("Page 1 Title");

    await dispose();
  });

  test("all three tools are returned", () => {
    const { tools, dispose } = buildBrowserTools({ browserFactory: async () => new FakeBrowserSession() });
    const names = tools.map((t) => t.name);
    expect(names).toContain("browser_search");
    expect(names).toContain("browser_navigate");
    expect(names).toContain("browser_extract");
    expect(tools).toHaveLength(3);
    dispose();
  });
});
