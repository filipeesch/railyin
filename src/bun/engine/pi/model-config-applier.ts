import type { PiModelConfig } from "../../config/index.ts";
import type { ModelParamValue, ModelSettingAxis } from "../../../shared/rpc-types.ts";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { resolveSamplingPreset } from "./sampling-params.ts";
import { CANONICAL_THINKING_LEVELS, canonicalThinkingLevel } from "./model-config.ts";

/**
 * Applies a Pi model's per-model config to an `AgentSession` for the current execution.
 *
 * Owns two responsibilities extracted from the PiEngine god-class:
 *  - `buildSettings` — derive the UI Mode/Sampling/axes from the model config.
 *  - `applyToSession` — resolve the active Mode/Reasoning axis to a canonical SDK
 *    thinking level, and assemble the `onPayload` request-body merge.
 *
 * Reasoning ownership contract: the **effort** key (`reasoning_effort`/`reasoningEffort`)
 * is owned by the pi SDK (driven by `session.agent.state.thinkingLevel` through the
 * model's `compat.thinkingFormat`), so Railyin never emits it. Provider-specific
 * reasoning knobs (`enable_thinking`, `thinking`, `chat_template_kwargs`) declared in
 * the config may still be forwarded through `onPayload` for per-model flexibility.
 */
export class PiModelConfigApplier {
  /** Derive the UI axes (Mode from variants, Sampling from presets, explicit `axes`). */
  buildSettings(modelCfg: PiModelConfig | undefined): ModelSettingAxis[] {
    const settings: ModelSettingAxis[] = [];

    const variants = modelCfg?.variants
      ? Object.keys(modelCfg.variants).filter((v) => modelCfg!.variants![v].disabled !== true)
      : [];
    if (variants.length > 0) {
      settings.push({
        id: "mode",
        label: "Mode",
        options: variants.map((value) => ({ value, label: modelCfg?.variants?.[value]?.label ?? value })),
        defaultValue: variants[0] ?? null,
        visible: true,
        axisType: "select",
      });
    }

    for (const axis of modelCfg?.axes ?? []) {
      settings.push({
        id: axis.id,
        label: axis.label,
        options: axis.options ?? [],
        defaultValue: axis.defaultValue ?? null,
        visible: axis.visible ?? true,
        axisType: axis.axisType ?? "select",
      });
    }

    return settings;
  }

  /**
   * Apply the per-model config to `session.agent`:
   *  - Resolves the active Mode/Reasoning axis value (UI `modelParams` override wins over config default)
   *    and sets `session.agent.state.thinkingLevel` to a canonical SDK level.
   *  - Deep-merges the model's static `options`, the selected Mode variant's options (minus the
   *    SDK-owned effort key), and custom-axis runtime overrides into the request body via `onPayload`.
   *  - Resolves the sampling preset against the active model set and merges its defined fields.
   */
  applyToSession(
    session: AgentSession,
    modelCfg: PiModelConfig | undefined,
    _modelStr: string,
    presetName: string | undefined,
    modelParams: ModelParamValue[] | undefined,
  ): void {
    const baseOptions = modelCfg?.options ?? {};
    const mergedOptions: Record<string, unknown> = { ...baseOptions };

    // Apply UI-editable custom axes via their runtime path templates.
    for (const axis of modelCfg?.axes ?? []) {
      const chosen = modelParams?.find((p) => p.id === axis.id)?.value ?? axis.defaultValue;
      if (chosen == null || !axis.runtime) continue;
      for (const [path, tmpl] of Object.entries(axis.runtime)) {
        if (typeof tmpl !== "string") continue;
        const resolved = tmpl.includes("{value}") ? tmpl.replace("{value}", String(chosen)) : tmpl;
        mergedOptions[path] = resolved;
      }
    }

    // Mode/Reasoning level → canonical SDK thinking level + variant body options.
    const modeValue =
      modelParams?.find((p) => p.id === "mode")?.value ?? modelParams?.find((p) => p.id === "thinkingLevel")?.value;
    if (modeValue) {
      const variantOpts = modelCfg?.variants?.[modeValue]?.options;
      const variantOptsRecord =
        variantOpts && typeof variantOpts === "object" ? (variantOpts as Record<string, unknown>) : {};
      // Canonical level derives from the variant's reasoningEffort, with a fallback
      // to the bare mode value when it is already a valid canonical level (legacy
      // level-based reasoning-mode path). Without either, it resolves to "off".
      const hasVariantEffort =
        variantOptsRecord.reasoningEffort !== undefined || variantOptsRecord.reasoning_effort !== undefined;
      const isCanonicalModeValue = (CANONICAL_THINKING_LEVELS as readonly string[]).includes(modeValue);
      session.agent.state.thinkingLevel = hasVariantEffort
        ? canonicalThinkingLevel(variantOptsRecord)
        : isCanonicalModeValue
          ? (modeValue as never)
          : ("off" as never);
      // Merge the variant's body options (excluding the SDK-owned effort key).
      for (const [key, value] of Object.entries(variantOptsRecord)) {
        if (key === "reasoning_effort" || key === "reasoningEffort") continue;
        mergedOptions[key] = value;
      }
    } else {
      session.agent.state.thinkingLevel = (modelCfg?.thinking_level ?? "off") as never;
    }

    // The effort key is SDK-owned (driven by thinkingLevel through compat.thinkingFormat).
    // Strip it from the final body regardless of source (base options, variant, or axis).
    delete mergedOptions.reasoning_effort;
    delete mergedOptions.reasoningEffort;

    const sampling = resolveSamplingPreset(presetName, modelCfg);
    if (sampling !== undefined) {
      session.agent.onPayload = (payload: unknown) => ({
        ...(payload as Record<string, unknown>),
        ...mergedOptions,
        ...sampling,
      });
    } else if (Object.keys(mergedOptions).length > 0) {
      session.agent.onPayload = (payload: unknown) => ({
        ...(payload as Record<string, unknown>),
        ...mergedOptions,
      });
    } else {
      session.agent.onPayload = undefined;
    }
  }
}
