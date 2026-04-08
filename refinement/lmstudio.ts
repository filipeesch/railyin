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
 * Perform the full LM Studio setup for a provider before running scenarios.
 * Skips load/unload for network providers (link_device set).
 * Returns a teardown function.
 */
export function setupProvider(provider: ProviderConfig): { teardown: () => void } {
  if (provider.link_device) {
    // Network provider — model is managed on the remote device
    console.log(`[lmstudio] network provider ${provider.id} via link_device: ${provider.link_device} — skipping local lms load`);
    return { teardown: () => {} };
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
    teardown: () => {
      unloadModels();
    },
  };
}
