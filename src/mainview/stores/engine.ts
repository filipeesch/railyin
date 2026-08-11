import { defineStore } from "pinia";
import { ref, computed } from "vue";
import { listEngines, api } from "../rpc";
import type { EngineInfo } from "@shared/rpc-types";
import * as jsYaml from "js-yaml";

export const useEngineStore = defineStore("engine", () => {
  const engines = ref<EngineInfo[]>([]);
  const selectedId = ref<string | null>(null);
  const yaml = ref("");
  const yamlValid = ref(true);
  const validationError = ref<string | null>(null);
  const loading = ref(false);
  const error = ref<string | null>(null);

  const selectedEngine = computed((): EngineInfo | null => {
    if (!selectedId.value) return null;
    return engines.value.find((e) => e.id === selectedId.value) ?? null;
  });

  async function loadEngines() {
    loading.value = true;
    error.value = null;
    try {
      engines.value = await listEngines();
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    } finally {
      loading.value = false;
    }
  }

  function selectEngine(id: string | null) {
    selectedId.value = id;
    if (id) {
      const engine = engines.value.find((e) => e.id === id);
      if (engine) {
        yaml.value = engine.yaml ?? "";
      }
    }
    validateYaml(yaml.value);
  }

  async function refreshYaml() {
    if (!selectedId.value) return;
    try {
      const result = await api("config.getEnginesYaml", {});
      yaml.value = result.yaml;
      validateYaml(yaml.value);
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e);
    }
  }

  function setYaml(value: string) {
    yaml.value = value;
    validateYaml(value);
    // Sync name from YAML to selected engine in sidebar
    if (selectedId.value) {
      try {
        const parsed = jsYaml.load(value);
        if (parsed && typeof parsed === "object" && "name" in parsed) {
          const name = (parsed as Record<string, unknown>).name as string;
          if (name) {
            const engine = engines.value.find((e) => e.id === selectedId.value);
            if (engine) engine.name = name;
          }
        }
      } catch {
        // Ignore parse errors during sync
      }
    }
  }

  function validateYaml(content: string) {
    try {
      jsYaml.load(content);
      yamlValid.value = true;
      validationError.value = null;
    } catch (err) {
      yamlValid.value = false;
      validationError.value = err instanceof Error ? err.message : String(err);
    }
  }

  async function saveYaml() {
    if (!yamlValid.value) {
      throw new Error("YAML validation error — fix before saving");
    }
    await api("config.saveEnginesYaml", { yaml: yaml.value });
    // Re-fetch after save
    engines.value = await listEngines();
    if (selectedId.value) {
      const engine = engines.value.find((e) => e.id === selectedId.value);
      if (engine) {
        yaml.value = engine.yaml ?? "";
      }
    }
  }

  function exportEngine(engine: EngineInfo) {
    const blob = new Blob([engine.yaml], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${engine.id}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return {
    engines,
    selectedId,
    selectedEngine,
    yaml,
    yamlValid,
    validationError,
    loading,
    error,
    loadEngines,
    selectEngine,
    refreshYaml,
    setYaml,
    validateYaml,
    saveYaml,
  };
});
