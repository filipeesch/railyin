/**
 * Unit tests for PiEngine.listModels().
 *
 * These tests use vi.spyOn(global, "fetch") so they run without any real
 * network access or LM Studio instance.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { PiEngine } from "../engine/pi/engine.ts";
import type { PiEngineConfig } from "../config/index.ts";
import { NullModelSettingsRepository } from "../db/repositories/model-settings-repository.ts";
import { BoardRepository } from "../db/board-repository.ts";
import { initDb } from "./helpers.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEngine(providers: PiEngineConfig["providers"] = {}): PiEngine {
  const config: PiEngineConfig = {
    type: "pi",
    providers,
  };
  return new PiEngine("pi-local", config, () => {}, () => {}, undefined, new NullModelSettingsRepository(), new BoardRepository(initDb()));
}

function okJsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ─── PI-LM-1: no providers configured ────────────────────────────────────────

describe("PI-LM-1: no providers configured → returns []", () => {
  it("returns empty array and never calls fetch", async () => {
    const spy = vi.spyOn(global, "fetch");
    const engine = makeEngine({});
    const models = await engine.listModels();
    expect(models).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });
});

// ─── PI-LM-2: correct URL — base_url already contains /v1 ───────────────────

describe("PI-LM-2: URL is base_url + /models (no extra /v1)", () => {
  it("calls <base_url>/models when base_url ends with /v1", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      okJsonResponse({ data: [] }),
    );

    const engine = makeEngine({
      lmstudio: { base_url: "http://localhost:1234/v1" },
    });
    await engine.listModels();

    expect(spy).toHaveBeenCalledOnce();
    const [calledUrl] = spy.mock.calls[0]!;
    expect(calledUrl).toBe("http://localhost:1234/v1/models");
    // Must NOT double the /v1
    expect(calledUrl).not.toContain("/v1/v1");
  });

  it("strips trailing slash before appending /models", async () => {
    const spy = vi.spyOn(global, "fetch").mockResolvedValue(
      okJsonResponse({ data: [] }),
    );

    const engine = makeEngine({
      lmstudio: { base_url: "http://localhost:1234/v1/" },
    });
    await engine.listModels();

    const [calledUrl] = spy.mock.calls[0]!;
    expect(calledUrl).toBe("http://localhost:1234/v1/models");
  });
});

// ─── PI-LM-3: happy path — maps fields and skips embed models ────────────────

describe("PI-LM-3: happy path — maps model list correctly", () => {
  it("returns qualified IDs, displayName, contextWindow and contextWindowEditable:true", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      okJsonResponse({
        data: [
          { id: "qwen/qwen3-27b", context_length: 32_768 },
          { id: "meta/llama-3.3-70b" },                          // no context_length
          { id: "text-embedding-nomic-embed-text-v1" },           // embed — skip
        ],
      }),
    );

    const engine = makeEngine({
      lmstudio: { base_url: "http://localhost:1234/v1" },
    });
    const models = await engine.listModels();

    expect(models).toHaveLength(2);

    expect(models[0]).toMatchObject({
      qualifiedId: "pi-local/lmstudio/qwen/qwen3-27b",
      displayName: "qwen/qwen3-27b",
      contextWindow: 32_768,
      contextWindowEditable: true,
    });

    expect(models[1]).toMatchObject({
      qualifiedId: "pi-local/lmstudio/meta/llama-3.3-70b",
      displayName: "meta/llama-3.3-70b",
      contextWindow: undefined,
      contextWindowEditable: true,
    });
  });
});

// ─── PI-LM-4: provider unreachable — warns and returns [] ────────────────────

describe("PI-LM-4: provider unreachable → warns and returns []", () => {
  it("returns empty array when fetch throws (e.g. ECONNREFUSED)", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const engine = makeEngine({
      lmstudio: { base_url: "http://localhost:1234/v1" },
    });
    const models = await engine.listModels();

    expect(models).toEqual([]);
    const listModelsWarn = warnSpy.mock.calls.find((c) => String(c[0]).includes("[pi] listModels"));
    expect(listModelsWarn).toBeDefined();
    expect(String(listModelsWarn![0])).toContain("lmstudio");
  });

  it("returns empty array when server returns non-ok status", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response("Not Found", { status: 404 }),
    );

    const engine = makeEngine({
      lmstudio: { base_url: "http://localhost:1234/v1" },
    });
    const models = await engine.listModels();

    expect(models).toEqual([]);
  });
});

// ─── PI-LM-5: multiple providers — aggregates all results ────────────────────

describe("PI-LM-5: multiple providers — aggregates results", () => {
  it("collects models from all reachable providers and skips unreachable ones", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(global, "fetch").mockImplementation((url) => {
      if (String(url).includes("1234")) {
        return Promise.resolve(okJsonResponse({ data: [{ id: "qwen/qwen3-8b", context_length: 8_192 }] }));
      }
      // second provider unreachable
      return Promise.reject(new Error("ECONNREFUSED"));
    });

    const engine = makeEngine({
      lmstudio: { base_url: "http://localhost:1234/v1" },
      ollama:   { base_url: "http://localhost:11434/v1" },
    });
    const models = await engine.listModels();

    expect(models).toHaveLength(1);
    expect(models[0]!.qualifiedId).toBe("pi-local/lmstudio/qwen/qwen3-8b");
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes("[pi] listModels"))).toBe(true);
  });
});
