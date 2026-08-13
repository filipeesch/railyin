/**
 * buildPiModelRuntime — creates a ModelRuntime for Pi agent sessions.
 *
 * The Pi SDK (>= 0.80.8) replaced `AuthStorage`/`modelRegistry` on
 * `CreateAgentSessionOptions` with the async `modelRuntime` option. This builder
 * produces a hermetic runtime that:
 *
 * - uses an in-memory credential store (no auth.json reads/writes),
 * - disables network catalog refresh (`refreshOnCreate: false`) — Railyin
 *   registers its own providers,
 * - registers every configured provider with its base URL, API key, and the
 *   resolved api mode, so the SDK dispatches to `/chat/completions` or
 *   `/responses` on the matching endpoint,
 * - ensures a `"default"` provider exists for models without a provider prefix,
 *   mirroring the legacy `authStorage.setRuntimeApiKey(model.provider, ...)`
 *   fallback for unconfigured providers.
 */

import type { PiEngineConfig } from "../../config/index.ts";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { resolvePiApiMode } from "./api-mode.ts";

/** Fallback base URL used when a model references a provider without config. */
export const DEFAULT_PROVIDER_BASE_URL = "http://localhost:1234/v1";
/** Placeholder API key for local endpoints that don't require auth. */
export const DEFAULT_PROVIDER_API_KEY = "no-key";

/**
 * Build a `ModelRuntime` for Pi sessions from engine config.
 *
 * @param config - The Pi engine config (providers map + engine-level api).
 */
export async function buildPiModelRuntime(config: PiEngineConfig): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    refreshOnCreate: false,
    modelsPath: null,
  });

  for (const [name, cfg] of Object.entries(config.providers ?? {})) {
    runtime.registerProvider(name, {
      baseUrl: cfg.base_url,
      apiKey: cfg.api_key ?? DEFAULT_PROVIDER_API_KEY,
      api: resolvePiApiMode(config, name),
    });
  }

  // Ensure a provider exists for unprefixed model ids (the "default" provider).
  if (!runtime.getRegisteredProviderIds().includes("default")) {
    runtime.registerProvider("default", {
      baseUrl: DEFAULT_PROVIDER_BASE_URL,
      apiKey: DEFAULT_PROVIDER_API_KEY,
      api: resolvePiApiMode(config, undefined),
    });
  }

  return runtime;
}
