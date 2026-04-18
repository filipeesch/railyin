<template>
  <div class="lsp-prompt">
    <h3 class="lsp-prompt__title">Language Server Setup</h3>
    <p class="lsp-prompt__hint">
      Railyn detected the following languages in this project. Install their
      language servers to enable code navigation and completions.
    </p>

    <div
      v-for="lang in detectedLanguages"
      :key="lang.entry.serverName"
      class="lsp-lang-card"
    >
      <!-- Header row -->
      <div class="lsp-lang-card__header">
        <span class="lsp-lang-card__name">{{ lang.entry.name }}</span>
        <Tag
          v-if="lang.alreadyInstalled && !states[lang.entry.serverName]?.installed"
          value="Installed"
          severity="success"
          class="lsp-lang-card__badge"
        />
        <Tag
          v-else-if="!lang.alreadyInstalled && !states[lang.entry.serverName]?.installed"
          value="Not installed"
          severity="secondary"
          class="lsp-lang-card__badge"
        />
        <Tag
          v-if="states[lang.entry.serverName]?.installed"
          value="Done"
          severity="success"
          class="lsp-lang-card__badge"
        />
        <Tag
          v-if="states[lang.entry.serverName]?.error"
          value="Error"
          severity="danger"
          class="lsp-lang-card__badge"
        />
      </div>

      <!-- Already installed: offer "Add to config" only -->
      <template v-if="lang.alreadyInstalled && !states[lang.entry.serverName]?.installed">
        <p class="lsp-lang-card__installed-note">
          {{ lang.entry.serverName }} is already on your PATH.
        </p>
        <Button
          label="Add to workspace config"
          icon="pi pi-file-edit"
          size="small"
          severity="secondary"
          :loading="states[lang.entry.serverName]?.adding"
          :disabled="!!states[lang.entry.serverName]?.added"
          @click="addToConfig(lang)"
        />
        <span v-if="states[lang.entry.serverName]?.added" class="lsp-lang-card__ok">
          ✓ Added to workspace.yaml
        </span>
      </template>

      <!-- Not installed: show install option selector -->
      <template v-if="!lang.alreadyInstalled && lang.installOptions.length">
        <div class="lsp-lang-card__options">
          <label class="lsp-lang-card__options-label">Install via</label>
          <Select
            v-model="selectedOption[lang.entry.serverName]"
            :options="lang.installOptions"
            optionLabel="label"
            class="lsp-lang-card__select"
          />
        </div>
        <Button
          label="Install"
          icon="pi pi-download"
          size="small"
          :loading="states[lang.entry.serverName]?.running"
          :disabled="!selectedOption[lang.entry.serverName] || !!states[lang.entry.serverName]?.installed"
          @click="install(lang)"
        />
      </template>

      <!-- No install options for this language on this platform -->
      <template v-if="!lang.alreadyInstalled && !lang.installOptions.length">
        <p class="lsp-lang-card__no-options">
          No automatic install option available for your platform. Install
          <code>{{ lang.entry.serverName }}</code> manually and click
          "Add to config".
        </p>
        <Button
          label="Add to workspace config"
          icon="pi pi-file-edit"
          size="small"
          severity="secondary"
          :loading="states[lang.entry.serverName]?.adding"
          :disabled="!!states[lang.entry.serverName]?.added"
          @click="addToConfig(lang)"
        />
        <span v-if="states[lang.entry.serverName]?.added" class="lsp-lang-card__ok">
          ✓ Added to workspace.yaml
        </span>
      </template>

      <!-- Inline install output -->
      <pre
        v-if="outputs[lang.entry.serverName]"
        class="lsp-lang-card__output"
      >{{ outputs[lang.entry.serverName] }}</pre>
    </div>

    <!-- Footer actions -->
    <div class="lsp-prompt__footer">
      <Button
        :label="allDone ? 'Done' : 'Skip'"
        :icon="allDone ? 'pi pi-check' : 'pi pi-forward'"
        @click="emit('done')"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed } from "vue";
import Tag from "primevue/tag";
import Button from "primevue/button";
import Select from "primevue/select";
import { api } from "../rpc";
import type { LspDetectedLanguage, LspInstallOption } from "../../shared/rpc-types";

// ─── Props / Emits ─────────────────────────────────────────────────────────

const props = defineProps<{
  detectedLanguages: LspDetectedLanguage[];
  projectPath: string;
}>();

const emit = defineEmits<{
  done: [];
}>();

// ─── Per-language reactive state ───────────────────────────────────────────

interface LangState {
  running?: boolean;
  installed?: boolean;
  error?: boolean;
  adding?: boolean;
  added?: boolean;
}

const states = reactive<Record<string, LangState>>({});
const outputs = reactive<Record<string, string>>({});

/** Selected install option per server name. */
const selectedOption = reactive<Record<string, LspInstallOption | undefined>>(() => {
  const init: Record<string, LspInstallOption | undefined> = {};
  for (const lang of props.detectedLanguages) {
    init[lang.entry.serverName] = lang.installOptions[0];
  }
  return init;
});

// ─── Derived ───────────────────────────────────────────────────────────────

const allDone = computed(() =>
  props.detectedLanguages.every(
    (lang) =>
      lang.alreadyInstalled ||
      states[lang.entry.serverName]?.installed ||
      states[lang.entry.serverName]?.added
  )
);

// ─── Actions ───────────────────────────────────────────────────────────────

async function install(lang: LspDetectedLanguage) {
  const option = selectedOption[lang.entry.serverName];
  if (!option) return;

  const key = lang.entry.serverName;
  if (!states[key]) states[key] = {};
  states[key].running = true;
  states[key].error = false;
  outputs[key] = "";

  try {
    const result = await api("lsp.runInstall", {
      command: option.command,
      projectPath: props.projectPath,
    });
    outputs[key] = result.output;
    if (result.success) {
      states[key].installed = true;
    } else {
      states[key].error = true;
    }
  } catch (e) {
    outputs[key] = e instanceof Error ? e.message : String(e);
    states[key].error = true;
  } finally {
    states[key].running = false;
  }
}

async function addToConfig(lang: LspDetectedLanguage) {
  const key = lang.entry.serverName;
  if (!states[key]) states[key] = {};
  states[key].adding = true;

  try {
    await api("lsp.addToConfig", {
      projectPath: props.projectPath,
      languageServerName: key,
    });
    states[key].added = true;
  } finally {
    states[key].adding = false;
  }
}
</script>

<style scoped>
.lsp-prompt__title {
  margin: 0 0 4px;
  font-size: 1rem;
  font-weight: 600;
}

.lsp-prompt__hint {
  font-size: 0.85rem;
  color: var(--p-text-muted-color, #64748b);
  margin: 0 0 16px;
}

.lsp-lang-card {
  border: 1px solid var(--p-surface-200, #e2e8f0);
  border-radius: 8px;
  padding: 12px 14px;
  margin-bottom: 10px;
  display: flex;
  flex-direction: column;
  gap: 8px;
  background: var(--p-surface-50, #f8fafc);
}

.lsp-lang-card__header {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lsp-lang-card__name {
  font-weight: 600;
  font-size: 0.9rem;
  flex: 1;
}

.lsp-lang-card__badge {
  font-size: 0.75rem;
}

.lsp-lang-card__installed-note,
.lsp-lang-card__no-options {
  font-size: 0.82rem;
  color: var(--p-text-muted-color, #64748b);
  margin: 0;
}

.lsp-lang-card__options {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lsp-lang-card__options-label {
  font-size: 0.82rem;
  white-space: nowrap;
}

.lsp-lang-card__select {
  flex: 1;
}

.lsp-lang-card__output {
  font-size: 0.78rem;
  background: var(--p-surface-900, #0f172a);
  color: var(--p-surface-100, #f1f5f9);
  border-radius: 6px;
  padding: 8px 12px;
  max-height: 160px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}

.lsp-lang-card__ok {
  font-size: 0.82rem;
  color: var(--p-green-500, #22c55e);
}

.lsp-prompt__footer {
  display: flex;
  justify-content: flex-end;
  margin-top: 8px;
}
</style>

<style>
html.dark-mode .lsp-lang-card {
  background: var(--p-surface-800, #1e293b);
  border-color: var(--p-surface-700, #334155);
}
</style>
