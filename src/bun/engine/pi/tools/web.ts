import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { HarnessContext } from "../harness/context.ts";
import { Type } from "@earendil-works/pi-ai";
import { sanitizeHtml, htmlToMarkdown } from "./html-sanitizer.ts";
import { buildBrowserTools, type BrowserToolsOptions } from "./browser.ts";
import { runChildSession, type RunChildSessionOptions } from "./child-runner.ts";

const FETCH_LIMIT = 20 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

// ─── Web Search Child Agent System Prompt ────────────────────────────────────

/**
 * System prompt for the web search child agent.
 * Provides a detailed playbook for research strategy, stopping criteria,
 * and output format. The agent receives a research brief (context + goal + hints)
 * as the user prompt and decides what to search for.
 */
const WEB_SEARCH_SYSTEM_SUFFIX = `

# Web Research Agent

You are a web research assistant. You receive a research brief that describes what needs to be investigated. Your job is to search the internet, navigate to relevant pages, and extract information to answer the research question.

## Available Tools
- \`browser_search(query)\`: Search Google and return sanitized HTML results. The LLM can parse the HTML to find relevant links and snippets.
- \`browser_navigate(url)\`: Navigate to a specific URL found from search results.
- \`browser_extract()\`: Extract readable text/markdown from the current page. Use after browser_navigate.

## Research Strategy (Detailed Playbook)

Follow this step-by-step approach for every research task:

### Step 1: Analyze the Research Brief
Read the brief carefully. Identify:
- The core question being asked
- Key technologies, versions, or concepts mentioned
- Any error messages or symptoms provided
- What success looks like (what would constitute a complete answer)

### Step 2: Craft Your First Search Query
- Start with a broad but targeted query that captures the essence of the question
- Include key technologies, versions, and specific terms from the brief
- Example: For "Does Spring Boot 3.2 support Hibernate 3.6 OneToMany in Kotlin?", search: "Spring Boot 3.2 Hibernate 3.6 OneToMany Kotlin support"

### Step 3: Evaluate Search Results
- Parse the HTML results to find the most relevant links
- Prioritize: official documentation, GitHub issues, Stack Overflow, reputable blogs
- Look for multiple sources that confirm the same information
- If results are irrelevant, refine your query and search again

### Step 4: Deep-Dive into Promising Sources
- Navigate to 2-3 of the most relevant URLs
- Extract page content to read the full answer
- Take note of specific details, version numbers, and code examples
- Cross-reference information between sources for accuracy

### Step 5: Refine and Verify
- If the initial sources don't provide a complete answer, search for more specific queries
- Look for version-specific information, known issues, or workarounds
- Verify that the information applies to the exact technologies and versions mentioned

### Step 6: Synthesize and Return
- When you have enough information from at least 2-3 authoritative sources, return your answer
- If you cannot find relevant information after reasonable effort, say so clearly rather than guessing

## Stopping Criteria

Stop searching and return your answer when:
- You have visited at least 2-3 authoritative sources
- You can state your answer with confidence
- You have identified all relevant information the brief asked for
- You are running low on your step budget (aim to complete within 25 steps)
- You have exhausted reasonable search attempts and cannot find the information

## Output Format

When you have gathered enough information, return your answer in this exact format:

## Answer
[Your concise, direct answer to the research question. Address the specific question asked.]

## Details
[Any additional context, version-specific notes, or implementation guidance.]

## Sources
- [Source 1 URL](brief description of what it confirms)
- [Source 2 URL](brief description of what it confirms)
- [Source 3 URL](brief description of what it confirms)

## Guidelines
- Be concise — aim for a clear, actionable answer, not an exhaustive report
- Cite all sources with specific URLs, not just domain names
- Prefer official documentation, repositories, and authoritative sources
- Include version-specific information when relevant
- If sources conflict, mention the discrepancy and your assessment
- If you cannot find the information, say so clearly rather than speculating
- Do not hallucinate information — only report what you found
- Your step budget is limited — use it wisely and prioritize quality over quantity`;

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
  prompt: Type.String({
    description:
      "A detailed research brief describing what needs to be investigated. " +
      "Include context about what you are doing, the specific goal or question, " +
      "and any hints such as error messages or symptoms. " +
      "The child agent will read this brief and decide what to search for. " +
      "Write a comprehensive brief (~300-500 words) with the following structure:\n\n" +
      "1. Context: Describe the project, technologies, and current situation.\n" +
      "2. Goal: State the specific research question or problem to solve.\n" +
      "3. Hints: Include any error messages, stack traces, or relevant observations.\n\n" +
      "Example:\n" +
      "  Context: We are building a Spring Boot 3.2 application with Kotlin 1.9 and Maven. " +
      "  We have User and Order entities with a OneToMany relationship using Hibernate 3.6.\n\n" +
      "  Goal: Determine if Spring Boot 3.2 fully supports Hibernate 3.6 for OneToMany " +
      "  relationships in Kotlin classes, and identify any known compatibility issues.\n\n" +
      "  Hints: We get org.hibernate.MappingException when persisting User with List<Order>. " +
      "  The @OneToMany annotation is on the User class.",
  }),
});

/**
 * Build the web_search tool that spawns a child agent with browser automation tools.
 * The child agent receives a research brief and performs browser-based research
 * to answer the question. It searches Google, navigates to pages, and extracts content.
 *
 * The parent agent composes a detailed research brief (context + goal + hints)
 * and passes it as the prompt parameter. The child agent decides what to search for.
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
      "Research a topic using a browser-based web agent. " +
      "The agent receives a research brief and performs internet research: " +
      "searching Google, navigating to relevant pages, and extracting content. " +
      "Returns a detailed markdown answer with sources.\n\n" +
      "Provide a comprehensive research brief (~300-500 words) that includes:\n" +
      "1. Context: What you are working on, technologies, current situation.\n" +
      "2. Goal: The specific question or problem to research.\n" +
      "3. Hints: Error messages, stack traces, or relevant observations.\n\n" +
      "EXAMPLES:\n" +
      "  web_search({\n" +
      "    prompt: 'Context: We are building a Spring Boot 3.2 app with Kotlin and Hibernate 3.6.\\n' +\n" +
      "            'Goal: Does Spring Boot 3.2 support Hibernate 3.6 for OneToMany in Kotlin?\\n' +\n" +
      "            'Hints: org.hibernate.MappingException when persisting User with List<Order>.'\n" +
      "  })",
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
          prompt: args.prompt,
          signal,
          delegateEmitRef,
          onRawModelMessage,
          childSessionFactory,
          limiterRegistry,
          parentConversationId,
          parentToolCallId: toolCallId,
          maxSteps,
          excludeSdkBuiltins: true,
        });

        if (!runnerResult.ok) {
          return {
            content: [{ type: "text", text: `Error: ${runnerResult.error ?? "Web search failed"}` }],
            details: { prompt: args.prompt },
            isError: true,
          };
        }

        return {
          content: [{ type: "text", text: runnerResult.text }],
          details: { prompt: args.prompt, durationMs: runnerResult.durationMs },
        };
      } catch (err: any) {
        return {
          content: [{ type: "text", text: `Error: ${err?.message ?? String(err)}` }],
          details: { prompt: args.prompt },
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
