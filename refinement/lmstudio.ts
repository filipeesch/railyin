/**
 * refinement/lmstudio.ts
 *
 * LM Studio CLI lifecycle management for lmstudio-type providers.
 * Handles model loading, unloading, health-checking, and CLI availability.
 */

import { spawnSync } from "child_process";
import type { ProviderConfig } from "./types.ts";

/** Check that the lms CLI is available. Returns true if found. */
export function checkLmsCli(): boolean {
  try {
    const result = spawnSync("which", ["lms"], { encoding: "utf-8", timeout: 5000 });
    return result.status === 0 && result.stdout.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Load a model into LM Studio via the lms CLI.
 * @param modelKey The model key as it appears in lms (e.g. "qwen2.5-coder-32b-instruct")
 * @param gpu GPU fraction to use (e.g. 1.0 for max). Defaults to 1.0.
 */
export function loadModel(modelKey: string, gpu: number = 1.0): void {
  console.log(`[lmstudio] loading model: ${modelKey} (gpu: ${gpu})`);
  const gpuArg = String(gpu);
  const result = spawnSync("lms", ["load", modelKey, "--gpu", gpuArg, "-y"], {
    encoding: "utf-8",
    timeout: 120_000, // 2 min max for model load
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    const errorMsg = stderr || result.error?.message || "unknown error";
    throw new Error(`[lmstudio] lms load failed for ${modelKey}: ${errorMsg}`);
  }
  console.log(`[lmstudio] model loaded: ${modelKey}`);
}

/** Unload all models via lms unload --all. */
export function unloadModels(): void {
  console.log("[lmstudio] unloading all models");
  const result = spawnSync("lms", ["unload", "--all"], {
    encoding: "utf-8",
    timeout: 30_000,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    console.warn(`[lmstudio] lms unload warning: ${stderr}`);
  }
}

/**
 * Check that a model is running via lms ps --json.
 * Retries once after 3s if not found on first check.
 * @returns true if the model is ready, false otherwise.
 */
export function healthCheck(modelKey: string): boolean {
  const check = (): boolean => {
    try {
      const result = spawnSync("lms", ["ps", "--json"], {
        encoding: "utf-8",
        timeout: 10_000,
        stdio: ["ignore", "pipe", "pipe"],
      });
      if (result.status !== 0 || !result.stdout.trim()) return false;
      const parsed = JSON.parse(result.stdout.trim());
      const models: Array<{ identifier?: string; path?: string }> = Array.isArray(parsed)
        ? parsed
        : (parsed.models ?? []);
      return models.some(
        (m) =>
          m.identifier?.includes(modelKey) ||
          m.path?.includes(modelKey) ||
          modelKey.includes(m.identifier ?? "___"),
      );
    } catch {
      return false;
    }
  };

  if (check()) return true;

  // Retry once after 3 seconds
  console.log(`[lmstudio] health check: model not yet ready, retrying in 3s...`);
  Bun.sleepSync(3000);
  return check();
}

/**
 * Unload a specific model from a remote LM Studio instance via REST API.
 * Uses POST /api/v1/models/unload (LM Studio 0.4+ management API).
 */
export async function unloadNetworkModel(backendUrl: string, modelKey: string): Promise<void> {
  console.log(`[lmstudio] unloading remote model: ${modelKey}`);
  try {
    const resp = await fetch(`${backendUrl}/api/v1/models/unload`, {
      method: "POST",
      headers: new Headers({ "content-type": "application/json" }),
      body: JSON.stringify({ instance_id: modelKey }),
    });
    if (resp.status === 404) {
      console.log(`[lmstudio] remote model already unloaded: ${modelKey}`);
    } else if (!resp.ok) {
      const body = await resp.text().catch(() => "");
      console.warn(`[lmstudio] remote unload warning (${resp.status}): ${body}`);
    } else {
      console.log(`[lmstudio] remote model unloaded: ${modelKey}`);
    }
  } catch (err) {
    console.warn(`[lmstudio] remote unload failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/**
 * Perform the full LM Studio setup for a provider before running scenarios.
 * For network providers (link_device set), registers a teardown that unloads the model via REST.
 * Returns a teardown function.
 */
export function setupProvider(provider: ProviderConfig): { teardown: () => Promise<void> } {
  if (provider.link_device) {
    // Network provider — model is managed on the remote device; unload via REST on teardown
    console.log(`[lmstudio] network provider ${provider.id} via link_device: ${provider.link_device} — skipping local lms load`);
    const backendUrl = provider.backendUrl ?? `http://${provider.host ?? "localhost"}:${provider.port ?? 1234}`;
    const modelKey = provider.model_key!;
    return {
      teardown: () => unloadNetworkModel(backendUrl, modelKey),
    };
  }

  const modelKey = provider.model_key!;
  const gpu = provider.gpu ?? 1.0;

  loadModel(modelKey, gpu);

  const ready = healthCheck(modelKey);
  if (!ready) {
    unloadModels();
    throw new Error(`[lmstudio] model ${modelKey} did not become ready after lms load`);
  }

  console.log(`[lmstudio] model ${modelKey} is ready`);

  return {
    teardown: async () => {
      unloadModels();
    },
  };
}
