import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";
import { getDataDir } from "../../utils/platform.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ParsedPromptMeta {
  model: string;
  description?: string;
  engine?: string[];
  priority: number;
  enabled: boolean;
  context: "task" | "chat" | "both";
  sourceFile: string;
}

export interface ResolvedCustomPrompt {
  content: string;
  priority: number;
  description?: string;
}

export interface PromptFilterContext {
  modelId: string;
  engineId: string;
  executionType: "task" | "chat";
  projectPath?: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GLOBAL_PROMPTS_DIR = join(getDataDir(), "system-prompts");
const PROJECT_PROMPTS_REL = ".railyin/system-prompts";
const MAX_CUSTOM_PROMPT_CHARS = 10240;

// ─── Parsing ──────────────────────────────────────────────────────────────────

function parseFrontMatter(raw: string): { frontMatter: Record<string, unknown>; bodyStart: number } {
  const lines = raw.split("\n");
  if (lines[0].trim() !== "---") throw new Error("Missing opening ---");

  let bodyStart = -1;
  const fmLines: string[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === "---") { bodyStart = i + 1; break; }
    fmLines.push(lines[i]);
  }
  if (bodyStart === -1) throw new Error("Missing closing ---");

  const frontMatter = yaml.load(fmLines.join("\n")) as Record<string, unknown>;
  return { frontMatter: frontMatter ?? {}, bodyStart };
}

function extractMeta(fm: Record<string, unknown>, filePath: string): ParsedPromptMeta | null {
  const modelVal = fm.model;
  if (typeof modelVal !== "string" || !modelVal.trim()) {
    console.warn(`[custom-prompts] Skipped ${filePath}: missing or invalid 'model' field`);
    return null;
  }

  // Validate pattern: try matching something first (throws on bad syntax)
  try { require("minimatch").minimatch("x", modelVal, { matchBase: true }); } catch { console.warn(`[custom-prompts] Skipped ${filePath}: invalid pattern '${modelVal}'`); return null; }

  // Parse engine field
  const engineVal = fm.engine;
  const engineArr = engineVal ? (Array.isArray(engineVal) ? engineVal : typeof engineVal === "string" ? engineVal.split(",").map((s: string) => s.trim()).filter(Boolean) : undefined) : undefined;

  // Parse context field
  const contextVal = fm.context as string | undefined;
  const context = (contextVal === "task" || contextVal === "chat" || contextVal === "both"
    ? contextVal : "both") as "task" | "chat" | "both";

  return {
    model: modelVal.trim(),
    description: typeof fm.description === "string" ? fm.description : undefined,
    engine: engineArr,
    priority: typeof fm.priority === "number" ? fm.priority : 50,
    enabled: fm.enabled !== false,
    context,
    sourceFile: filePath,
  };
}

function matchesPrompt(meta: ParsedPromptMeta, filter: PromptFilterContext): boolean {
  if (!meta.enabled) return false;

  let modelMatch = false;
  try {
    modelMatch = require("minimatch").minimatch(filter.modelId, meta.model, { matchBase: true });
  } catch {
    console.warn(`[custom-prompts] Skipped ${meta.sourceFile}: invalid model pattern '${meta.model}'`);
    return false;
  }
  if (!modelMatch) return false;

  if (meta.engine && !meta.engine.includes(filter.engineId)) return false;
  if (meta.context !== "both" && meta.context !== filter.executionType) return false;
  return true;
}

// ─── Loading ──────────────────────────────────────────────────────────────────

function loadPromptsFromDir(dirPath: string): ParsedPromptMeta[] {
  if (!existsSync(dirPath)) return [];
  const results: ParsedPromptMeta[] = [];

  try {
    const files = readdirSync(dirPath).filter(f => f.endsWith(".md"));
    for (const file of files) {
      const filePath = join(dirPath, file);
      try {
        const raw = readFileSync(filePath, "utf-8");
        const { frontMatter } = parseFrontMatter(raw);
        const meta = extractMeta(frontMatter, filePath);
        if (meta) results.push(meta);
      } catch {
        console.warn(`[custom-prompts] Skipped ${filePath}: parse error`);
      }
    }
  } catch { /* silent */ }

  return results;
}

function readBody(filePath: string): string {
  const raw = readFileSync(filePath, "utf-8");
  const { bodyStart } = parseFrontMatter(raw);
  return raw.split("\n").slice(bodyStart).join("\n").trim();
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class CustomPromptInjector {

  resolve(filter: PromptFilterContext): string | undefined {
    const resolved = this.resolveList(filter);
    if (resolved.length === 0) return undefined;

    let totalChars = 0;
    const parts: string[] = [];

    for (let i = 0; i < resolved.length; i++) {
      const prompt = resolved[i];
      const charLen = prompt.content.length;

      if (totalChars + charLen > MAX_CUSTOM_PROMPT_CHARS && parts.length > 0) {
        const remaining = MAX_CUSTOM_PROMPT_CHARS - totalChars;
        if (remaining > 2) parts.push(prompt.content.slice(0, remaining));

        const skipped = resolved.length - i;
        parts.push(`[truncated: ${skipped} prompt${skipped > 1 ? "s" : ""} cut off to keep under ${MAX_CUSTOM_PROMPT_CHARS} char limit]`);
        console.warn(`[custom-prompts] Custom prompt total exceeded ${MAX_CUSTOM_PROMPT_CHARS} chars — truncated`);
        break;
      }

      parts.push(prompt.content);
      totalChars += charLen + 2;
    }

    return parts.join("\n\n");
  }

  resolveList(filter: PromptFilterContext): ResolvedCustomPrompt[] {
    const globalMeta = loadPromptsFromDir(GLOBAL_PROMPTS_DIR);
    const projectMeta = filter.projectPath
      ? loadPromptsFromDir(join(filter.projectPath, PROJECT_PROMPTS_REL))
      : [];

    const globalMatched = globalMeta.filter(m => matchesPrompt(m, filter));
    const projectMatched = projectMeta.filter(m => matchesPrompt(m, filter));

    const projectModels = new Set(projectMatched.map(p => p.model));
    const dedupedGlobal = globalMatched.filter(g => !projectModels.has(g.model));
    const merged = [...dedupedGlobal, ...projectMatched];

    return merged.map(m => ({
      content: readBody(m.sourceFile),
      priority: m.priority,
      description: m.description,
    })).sort((a, b) => a.priority - b.priority);
  }
}
