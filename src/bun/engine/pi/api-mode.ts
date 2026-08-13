/**
 * PiApiMode — config-driven selection of the OpenAI-compatible API mode.
 *
 * The Pi SDK's `Model.api` field selects the HTTP endpoint: "openai-completions"
 * routes to `${baseUrl}/chat/completions`, "openai-responses" routes to
 * `${baseUrl}/responses`. The mode is a property of the endpoint (the server),
 * so it is configured at the engine root with an optional per-provider override.
 *
 * Single source of truth for the resolution precedence:
 *   providers.<name>.api ?? config.api ?? DEFAULT_API_MODE
 * Consumed by PiModelBuilder (Model.api) and buildPiModelRuntime
 * (ProviderConfigInput.api) so both stay aligned.
 */

import type { PiEngineConfig, PiApiMode } from "../../config/index.ts";

export type { PiApiMode } from "../../config/index.ts";

/** Default mode when neither the engine root nor the provider declares `api`. */
export const DEFAULT_API_MODE: PiApiMode = "openai-responses";

/**
 * Resolve the effective API mode for a model served by `providerName`.
 *
 * - A provider-level `api` override wins when the provider is configured.
 * - Otherwise the engine-level `api` applies.
 * - When neither is set, the default (`openai-responses`) applies.
 *
 * @param config - The Pi engine config (engine root + providers).
 * @param providerName - The provider prefix of the model, or `undefined` for
 *   unprefixed models (the `"default"` provider).
 */
export function resolvePiApiMode(config: PiEngineConfig, providerName: string | undefined): PiApiMode {
  if (providerName !== undefined) {
    const providerApi = config.providers?.[providerName]?.api;
    if (providerApi !== undefined) return providerApi;
  }
  return config.api ?? DEFAULT_API_MODE;
}
