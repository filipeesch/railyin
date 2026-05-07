import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { HarnessContext } from "../harness/context.ts";
import { Type } from "@earendil-works/pi-ai";
import { getConfig } from "../../../config/index.ts";

const FETCH_LIMIT = 20 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

// ---------------------------------------------------------------------------
// HTML → plain text
// ---------------------------------------------------------------------------

function stripHtml(html: string): string {
  // Remove script and style blocks
  let text = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
  // Replace block-level tags with newlines
  text = text.replace(/<\/(p|div|h[1-6]|li|tr|blockquote|pre|br)[^>]*>/gi, "\n");
  text = text.replace(/<br\s*\/?>/gi, "\n");
  // Strip remaining tags
  text = text.replace(/<[^>]+>/g, "");
  // Decode common HTML entities
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

// ---------------------------------------------------------------------------
// fetch_url
// ---------------------------------------------------------------------------

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
Use search_internet first to find relevant URLs, then fetch_url for the full content.`,
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

      let text = isHtml ? stripHtml(raw) : raw;

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

// ---------------------------------------------------------------------------
// search_internet
// ---------------------------------------------------------------------------

const searchInternetParams = Type.Object({
  query: Type.String({
    description: "The search query.",
  }),
  num_results: Type.Optional(Type.Integer({
    default: 10,
    description: "Number of results to return (max 10).",
  })),
});

function searchInternetTool(_harnessCtx: HarnessContext): AgentTool<typeof searchInternetParams> {
  return {
    name: "search_internet",
    label: "Search Internet",
    description: `Search the web and return ranked results with title, URL, and snippet.

ALWAYS use search_internet before fetch_url when you need to find documentation or references.
Returns up to 10 results — follow up with fetch_url for full content.
Requires search configuration (engine + api_key) in workspace.yaml.`,
    parameters: searchInternetParams,
    execute: async (_id, args) => {
      let searchConfig: { engine: string; api_key: string } | undefined;
      try {
        searchConfig = getConfig().workspace.search;
      } catch {
        // config unavailable
      }

      if (!searchConfig?.engine || !searchConfig?.api_key) {
        return {
          content: [{ type: "text", text: "Error: search not configured — add search.engine and search.api_key to workspace.yaml" }],
          details: { query: args.query },
          isError: true,
        };
      }

      const numResults = Math.min(args.num_results ?? 10, 10);

      if (searchConfig.engine === "tavily") {
        let response: Response;
        try {
          response = await fetch("https://api.tavily.com/search", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "Authorization": `Bearer ${searchConfig.api_key}`,
            },
            body: JSON.stringify({
              query: args.query,
              max_results: numResults,
              search_depth: "basic",
            }),
          });
        } catch (err: any) {
          return {
            content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }],
            details: { query: args.query },
            isError: true,
          };
        }

        if (!response.ok) {
          const body = await response.text().catch(() => "");
          return {
            content: [{ type: "text", text: `Error: Tavily HTTP ${response.status} — ${body.slice(0, 200)}` }],
            details: { query: args.query, status: response.status },
            isError: true,
          };
        }

        const data = await response.json() as { results?: Array<{ title?: string; url?: string; content?: string }> };
        const results = data.results ?? [];

        if (results.length === 0) {
          return {
            content: [{ type: "text", text: `[No results for: ${args.query}]` }],
            details: { query: args.query, count: 0 },
          };
        }

        const lines = results.map((r, i) =>
          `${i + 1}. ${r.title ?? "(no title)"}\n   URL: ${r.url ?? ""}\n   ${(r.content ?? "").slice(0, 300)}`,
        );
        const text = lines.join("\n\n");

        return {
          content: [{ type: "text", text }],
          details: { query: args.query, count: results.length },
        };
      }

      return {
        content: [{ type: "text", text: `Error: unsupported search engine "${searchConfig.engine}" — only "tavily" is supported` }],
        details: { query: args.query },
        isError: true,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export function buildWebTools(harnessCtx: HarnessContext): AgentTool<any>[] {
  return [fetchUrlTool(harnessCtx), searchInternetTool(harnessCtx)];
}
