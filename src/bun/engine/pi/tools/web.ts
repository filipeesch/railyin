import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { HarnessContext } from "../harness/context.ts";
import { Type } from "@earendil-works/pi-ai";
import { sanitizeHtml, htmlToMarkdown } from "./html-sanitizer.ts";
import { buildBrowserTools, type BrowserToolsOptions } from "./browser.ts";
import { runChildSession, type RunChildSessionOptions } from "./child-runner.ts";

const FETCH_LIMIT = 20 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

// ─── Web Search Child Agent System Prompt ────────────────────────────────────

const WEB_SEARCH_SYSTEM_SUFFIX = `

# Web Search Agent Instructions
You are a web research assistant. Your job is to search the internet, navigate to relevant pages, and extract information to answer the user's query.

## Tools Available
- \`browser_search(query)\`: Search Google and return sanitized HTML results
- \`browser_navigate(url)\`: Navigate to a specific URL
- \`browser_extract()\`: Extract readable text/markdown from the current page

## Strategy
1. Start with \`browser_search\` to find relevant pages
2. Use \`browser_navigate\` to visit the most promising URLs
3. Use \`browser_extract\` to read page content
4. Repeat as needed to gather sufficient information

## Output Format
When you have gathered enough information, return your answer in this format:

## Answer
[Your concise answer to the query]

## Sources
- [URL 1](brief description)
- [URL 2](brief description)
...

## Guidelines
- Be concise — aim for a clear answer, not an exhaustive report
- Cite all sources with URLs
- Prefer official documentation, repositories, and authoritative sources
- Stop when you have a sufficient answer — don't over-research
- If you cannot find relevant information, say so clearly`;

// ─── Web Search Parent Tool ──────────────────────────────────────────────────

/** Options for building the web_search tool. */
export interface WebSearchToolOptions {
  /** Child-spawning dependencies shared with delegate. */
  delegateEmitRef?: { emit?: (event: import("../../types.ts").EngineEvent) => void };
  childSessionFactory?: import("../child-session.ts").ChildSessionFactory;
  limiterRegistry?: import("../provider-limiter.ts").ProviderLimiterRegistry;
  parentModel?: import("@earendil-works/pi-ai").Model<"openai-completions">;
  parentSystemPrompt?: string;
  parentCwd?: string;
  parentConversationId?: number;
  engineConfig?: import("../../../config/index.ts").PiEngineConfig;
  onRawModelMessage?: (message: import("../../types.ts").RawModelMessage) => void;
  /** Factory for creating browser sessions (injected for testability). */
  browserFactory?: import("./browser.ts").BrowserSessionFactory;
}

const webSearchParams = Type.Object({
  query: Type.String({
    description: "The search query or research question. Be specific about what you're looking for.",
  }),
});

/**
 * Build the web_search tool that spawns a child agent with browser automation tools.
 * The child agent searches Google, navigates to pages, and extracts content to answer the query.
 */
export function buildWebSearchTool(_harnessCtx: HarnessContext, opts: WebSearchToolOptions): AgentTool<any>[] {
  const {
    limiterRegistry,
    parentModel,
    parentCwd,
    parentConversationId,
    engineConfig,
    delegateEmitRef,
    onRawModelMessage,
    childSessionFactory,
    browserFactory,
  } = opts;

  // Require core dependencies — return empty array if not available
  if (!limiterRegistry || !parentModel || !parentCwd || !engineConfig) {
    return [];
  }

  const maxSteps = engineConfig.harness?.web_search?.max_steps ?? 30;

  const tool: AgentTool<typeof webSearchParams> = {
    name: "web_search",
    label: "Web Search",
    description:
      "Search the internet using a browser-based research agent. " +
      "The agent will search Google, navigate to relevant pages, and extract content to answer your query. " +
      "Returns a concise markdown answer with a Sources section listing visited URLs.\n\n" +
      "Use this when you need current information, documentation, or references from the internet. " +
      "Be specific in your query for better results.",
    parameters: webSearchParams,
    execute: async (toolCallId, args, signal) => {
      // Build browser tools with the injected factory
      const browserResult = buildBrowserTools({ browserFactory });
      const browserTools = browserResult.tools;

      try {
        const runnerResult = await runChildSession({
          jobId: `web-search-${Date.now()}`,
          tools: browserTools,
          model: parentModel,
          config: engineConfig,
          parentSystemPrompt: opts.parentSystemPrompt,
          systemPromptSuffix: WEB_SEARCH_SYSTEM_SUFFIX,
          cwd: parentCwd,
          prompt: args.query,
          signal,
          delegateEmitRef,
          onRawModelMessage,
          childSessionFactory,
          limiterRegistry,
          parentConversationId,
          parentToolCallId: toolCallId,
          maxSteps,
        });

        if (!runnerResult.ok) {
          return {
            content: [{ type: "text", text: `Error: ${runnerResult.error ?? "Web search failed"}` }],
            details: { query: args.query },
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: runnerResult.text }],
          details: { query: args.query, durationMs: runnerResult.durationMs },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }],
          details: { query: args.query },
          isError: true,
        };
      } finally {
        // Clean up the browser session
        await browserResult.dispose();
      }
    },
  };

  return [tool];
}

// ─── fetch_url (kept as a fast fallback) ─────────────────────────────────────

const fetchUrlParams = Type.Object({
  url: Type.String({
    description: "The URL to fetch.",
  }),
  timeout_ms: Type.Optional(Type.Integer({
    default: FETCH_TIMEOUT_MS,
    description: "Request timeout in milliseconds. Defaults to 15000.",
  })),
});

function fetchUrlTool(_harnessCtx: HarnessContext): AgentTool<typeof fetchUrlParams> {
  return {
    name: "fetch_url",
    label: "Fetch URL",
    description: `Fetch a public URL and return its text content.

NEVER use fetch_url for URLs requiring authentication — only publicly accessible URLs work.
HTML pages are stripped to readable text automatically.
Large responses are truncated to 20KB — prefer specific documentation pages over tables of contents.
For comprehensive research, use web_search instead.`,
    parameters: fetchUrlParams,
    execute: async (_id, args) => {
      const timeoutMs = args.timeout_ms ?? FETCH_TIMEOUT_MS;

      let response: Response;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          response = await fetch(args.url, {
            signal: controller.signal,
            headers: { "User-Agent": "Mozilla/5.0 (compatible; Railyin/1.0)" },
          });
        } finally {
          clearTimeout(timer);
        }
      } catch (err: any) {
        const msg = err?.name === "AbortError"
          ? `Error: request timed out after ${timeoutMs}ms`
          : `Error: ${err?.message ?? String(err)}`;
        return {
          content: [{ type: "text", text: msg }],
          details: { url: args.url },
          isError: true,
        };
      }

      if (!response.ok) {
        return {
          content: [{ type: "text", text: `Error: HTTP ${response.status} ${response.statusText}` }],
          details: { url: args.url, status: response.status },
          isError: true,
        };
      }

      const contentType = response.headers.get("content-type") ?? "";
      const raw = await response.text();
      const isHtml = contentType.includes("text/html") || raw.trimStart().startsWith("<!") || raw.trimStart().startsWith("<html");

      let text = isHtml ? sanitizeHtml(raw) : raw;

      if (text.length > FETCH_LIMIT) {
        text = text.slice(0, FETCH_LIMIT) + "\n[content truncated]";
      }

      return {
        content: [{ type: "text", text }],
        details: { url: args.url, status: response.status, contentType },
      };
    },
  };
}

// ─── Exports ─────────────────────────────────────────────────────────────────

/**
 * Build web tools for the Pi agent.
 * Now includes web_search (browser-based) and fetch_url (fast fallback).
 * search_internet (Tavily) has been removed.
 */
export function buildWebTools(
  harnessCtx: HarnessContext,
  webSearchOpts: WebSearchToolOptions = {},
): AgentTool<any>[] {
  const tools: AgentTool<any>[] = [];

  // Add web_search if dependencies are available
  const wsTools = buildWebSearchTool(harnessCtx, webSearchOpts);
  tools.push(...wsTools);

  // Always include fetch_url as a fast fallback
  tools.push(fetchUrlTool(harnessCtx));

  return tools;
}
