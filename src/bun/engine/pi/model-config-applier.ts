import type { PiModelConfig } from "../../config/index.ts";
import type { ModelParamValue, ModelSettingAxis } from "../../../shared/rpc-types.ts";
import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { resolveSamplingPreset } from "./sampling-params.ts";

/**
 * Applies a Pi model's per-model config to an `AgentSession` for the current execution.
 *
 * Owns two responsibilities extracted from the PiEngine god-class:
 *  - `buildSettings` — derive the UI Mode/Sampling/axes from the model config.
 *  - `applyToSession` — resolve the active Mode/Reasoning axis and assemble the `onPayload`
 *    request-body merge.
 *
 * Reasoning is a **direct-injection** contract: the selected Mode variant's `thinking: bool`
 * and arbitrary `options` (e.g. `reasoning_effort: max/high/none`, `enable_thinking`,
 * `chat_template_kwargs`) are merged **verbatim** into the request body via `onPayload`.
 * `onPayload` runs after the SDK's `buildParams`, so these override the SDK's own reasoning
 * defaults. Railyin does NOT normalize canonical thinking levels or own a reasoning-effort key.
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
   *  - Resolves the active Mode/Reasoning axis value (UI `modelParams` override wins over config default).
   *  - Direct-injection reasoning: the selected variant's `thinking: bool` and `options` (e.g.
   *    `reasoning_effort`) are merged **verbatim** into the request body via `onPayload`, so the
   *    provider receives exactly the reasoning kwargs the config declares (no Pi thinkingLevel/map
   *    normalization). `onPayload` runs after the SDK's `buildParams`, so injected `thinking` /
   *    `reasoning_effort` override the SDK's defaults.
   *  - Deep-merges the model's static `options`, the selected Mode variant's `options`, and
   *    custom-axis runtime overrides into the request body.
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

    // Mode → direct-injection variant body + optional reasoning toggle + thinkingLevel sentinel.
    const modeValue =
      modelParams?.find((p) => p.id === "mode")?.value ?? modelParams?.find((p) => p.id === "thinkingLevel")?.value;

    if (modeValue) {
      const variantCfg = modelCfg?.variants?.[modeValue];
      const variantOpts = variantCfg?.options;
      const variantOptsRecord =
        variantOpts && typeof variantOpts === "object" ? (variantOpts as Record<string, unknown>) : {};

      // Direct-injection: merge the variant's `options` verbatim (incl. reasoning_effort).
      for (const [key, value] of Object.entries(variantOptsRecord)) {
        mergedOptions[key] = value;
      }

      // Optional explicit `thinking:{type:enabled|disabled}` toggle for the variant → reasoning sentinel.
      let reasoningEnabled: boolean;
      if (typeof variantCfg?.thinking === "boolean") {
        mergedOptions.thinking = { type: variantCfg.thinking ? "enabled" : "disabled" };
        reasoningEnabled = variantCfg.thinking;
      } else {
        // Sentinel fallback: a non-none reasoning effort implies reasoning is on.
        const effort = variantOptsRecord.reasoning_effort ?? variantOptsRecord.reasoningEffort;
        reasoningEnabled = typeof effort === "string" && effort !== "none";
      }
      session.agent.state.thinkingLevel = (reasoningEnabled
        ? (modelCfg?.thinking_level ?? "high")
        : "off") as never;
    } else {
      // No mode selected — fall back to the model default thinking level (legacy).
      session.agent.state.thinkingLevel = (modelCfg?.thinking_level ?? "off") as never;
    }

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
