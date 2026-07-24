/**
 * Browser automation tools for the web search child agent.
 *
 * Provides a `BrowserSession` interface for testability and a
 * Playwright-backed production implementation.
 *
 * The browser session is shared across tool calls within a single
 * web_search invocation via a factory closure pattern.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "@earendil-works/pi-ai";
import { sanitizeHtml, htmlToMarkdown } from "./html-sanitizer.ts";

// ─── Browser Session Interface ───────────────────────────────────────────────

/**
 * Abstract browser session interface for testability.
 * Production uses Playwright; tests inject a fake implementation.
 */
export interface BrowserSession {
  /** Current URL of the browser page. */
  readonly currentUrl: string;
  /** Search Google and return the sanitized HTML of the results page. */
  searchGoogle(query: string): Promise<string>;
  /** Navigate to a URL and return the final URL (after redirects). */
  navigate(url: string): Promise<string>;
  /** Extract readable text/markdown from the current page. */
  extractContent(): Promise<string>;
  /** Close the browser session and release resources. */
  close(): Promise<void>;
}

/** Factory function for creating browser sessions. */
export type BrowserSessionFactory = () => Promise<BrowserSession>;

// ─── Playwright Implementation ───────────────────────────────────────────────

/** Playwright-backed browser session implementation. */
export class PlaywrightBrowserSession implements BrowserSession {
  private browser: any = null;
  private page: any = null;
  currentUrl: string = "";

  constructor(
    private readonly launchOptions: { headless?: boolean; timeout?: number } = {},
  ) {}

  async initialize(): Promise<void> {
    if (this.page) return; // already initialized
    const playwright = await import("playwright");
    this.browser = await playwright.chromium.launch({
      headless: this.launchOptions.headless ?? true,
    });
    this.page = await this.browser.newPage({
      userAgent: "Mozilla/5.0 (compatible; Railyin/1.0; +https://railyin.com)",
    });
    this.page.setDefaultTimeout(this.launchOptions.timeout ?? 30_000);
  }

  async searchGoogle(query: string): Promise<string> {
    await this.initialize();
    const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`;
    await this.page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    this.currentUrl = this.page.url();

    // Get the page content and sanitize it
    const html = await this.page.content();
    return sanitizeHtml(html);
  }

  async navigate(url: string): Promise<string> {
    await this.initialize();
    await this.page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
    this.currentUrl = this.page.url();
    return this.currentUrl;
  }

  async extractContent(): Promise<string> {
    await this.initialize();
    const html = await this.page.content();
    return htmlToMarkdown(html);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close().catch(() => {});
      this.browser = null;
      this.page = null;
      this.currentUrl = "";
    }
  }
}

/** Production factory that creates Playwright browser sessions. */
export const createPlaywrightBrowserSession: BrowserSessionFactory = async () => {
  const session = new PlaywrightBrowserSession();
  await session.initialize();
  return session;
};

// ─── Browser Tools Builder ───────────────────────────────────────────────────

/** Options for building browser tools with dependency injection. */
export interface BrowserToolsOptions {
  /** Factory for creating browser sessions (injected for testability). */
  browserFactory?: BrowserSessionFactory;
}

const browserSearchParams = Type.Object({
  query: Type.String({
    description: "The search query to look up on Google.",
  }),
});

const browserNavigateParams = Type.Object({
  url: Type.String({
    description: "The URL to navigate to.",
  }),
});

const browserExtractParams = Type.Object({});

/**
 * Build browser automation tools for the web search child agent.
 *
 * IMPORTANT: The returned tools share a single browser session created lazily
 * on first use. The caller MUST call `dispose()` when done to close the session.
 * This allows the child agent to search, navigate, and extract across multiple
 * tool calls within a single web_search invocation.
 *
 * @returns The tools array and a dispose function to clean up the session.
 */
export function buildBrowserTools(opts: BrowserToolsOptions = {}): {
  tools: AgentTool<any>[];
  /** Call this when the web_search tool finishes to close the browser session. */
  dispose: () => Promise<void>;
} {
  const browserFactory = opts.browserFactory ?? createPlaywrightBrowserSession;

  // Shared browser session — created lazily on first tool call.
  let session: BrowserSession | null = null;
  let sessionPromise: Promise<BrowserSession> | null = null;

  async function getSession(): Promise<BrowserSession> {
    if (session) return session;
    if (sessionPromise) return sessionPromise;
    sessionPromise = browserFactory().then((s) => { session = s; return s; });
    return sessionPromise;
  }

  const browserSearch: AgentTool<typeof browserSearchParams> = {
    name: "browser_search",
    label: "Browser Search",
    description:
      "Search Google and return the search results page as sanitized HTML. " +
      "The LLM can parse the HTML to find relevant links and snippets. " +
      "Use this to find documentation, references, or information about a topic.",
    parameters: browserSearchParams,
    execute: async (_id, args) => {
      try {
        const s = await getSession();
        const html = await s.searchGoogle(args.query);
        return {
          content: [{ type: "text", text: html }],
          details: { query: args.query, url: s.currentUrl },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }],
          details: { query: args.query },
          isError: true,
        };
      }
    },
  };

  const browserNavigate: AgentTool<typeof browserNavigateParams> = {
    name: "browser_navigate",
    label: "Browser Navigate",
    description:
      "Navigate the browser to a specific URL. Returns the final URL after redirects. " +
      "Use this to visit a specific page found from search results.",
    parameters: browserNavigateParams,
    execute: async (_id, args) => {
      try {
        const s = await getSession();
        const url = await s.navigate(args.url);
        return {
          content: [{ type: "text", text: `Navigated to: ${url}` }],
          details: { url },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }],
          details: { url: args.url },
          isError: true,
        };
      }
    },
  };

  const browserExtract: AgentTool<typeof browserExtractParams> = {
    name: "browser_extract",
    label: "Browser Extract",
    description:
      "Extract readable text/markdown from the current page. " +
      "Use this after browser_navigate to read the page content. " +
      "Returns sanitized markdown suitable for the LLM to process.",
    parameters: browserExtractParams,
    execute: async (_id, _args) => {
      try {
        const s = await getSession();
        const content = await s.extractContent();
        return {
          content: [{ type: "text", text: content }],
          details: { url: s.currentUrl },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }],
          details: {},
          isError: true,
        };
      }
    },
  };

  return {
    tools: [browserSearch, browserNavigate, browserExtract],
    dispose: async () => {
      // Ensure the session is initialized before closing
      if (sessionPromise && !session) {
        try { await sessionPromise; } catch { /* ignore */ }
      }
      await session?.close();
      session = null;
      sessionPromise = null;
    },
  };
}
