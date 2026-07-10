/**
 * createPiEngine() — production factory for PiEngine.
 *
 * Wires all services and returns a configured PiEngine instance.
 * Use this in src/bun/index.ts instead of calling new PiEngine() directly.
 */

import { PiEngine } from "./engine.ts";
import type { PiEngineConfig } from "../../config/index.ts";
import type { OnTaskUpdated, OnNewMessage } from "../types.ts";
import type { SlashCommandDialect } from "../dialects/slash-command-dialect.ts";
import type { ModelSettingsRepository } from "../../db/repositories/model-settings-repository.ts";
import { ProviderLimiterRegistry } from "./provider-limiter.ts";

export interface CreatePiEngineOptions {
  engineId: string;
  config: PiEngineConfig;
  onTaskUpdated: OnTaskUpdated;
  onNewMessage: OnNewMessage;
  dialect?: SlashCommandDialect;
  modelSettingsRepo: ModelSettingsRepository;
  registry?: ProviderLimiterRegistry;
}

export function createPiEngine(options: CreatePiEngineOptions): PiEngine {
  const { engineId, config, onTaskUpdated, onNewMessage, dialect, modelSettingsRepo, registry } = options;
  return new PiEngine(
    engineId,
    config,
    onTaskUpdated,
    onNewMessage,
    dialect,
    modelSettingsRepo,
    undefined, // use default session factory
    registry,
  );
}
