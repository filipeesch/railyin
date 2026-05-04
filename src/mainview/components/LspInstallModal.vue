<template>
  <Dialog
    :visible="true"
    modal
    :header="`Set up ${lang.entry.name}`"
    :style="{ width: '480px' }"
    @update:visible="(v) => { if (!v) emit('cancel'); }"
  >
    <div class="lsp-modal">
      <!-- Status badge row -->
      <div class="lsp-modal__status-row">
        <Tag
          v-if="lang.alreadyInstalled && !installed"
          value="Binary found on PATH"
          severity="success"
        />
        <Tag v-else-if="!lang.alreadyInstalled && !installed" value="Not installed" severity="secondary" />
        <Tag v-if="installed" value="Done" severity="success" />
        <Tag v-if="hasError" value="Error" severity="danger" />
      </div>

      <!-- Already installed: just add to config -->
      <template v-if="lang.alreadyInstalled && !installed">
        <p class="lsp-modal__hint">
          <strong>{{ lang.entry.serverName }}</strong> is already on your PATH.
          Add it to workspace config to enable it for this project.
        </p>
        <div v-if="!added" class="lsp-modal__action-row">
          <Button
            label="Add to workspace config"
            icon="pi pi-file-edit"
            :loading="adding"
            @click="addToConfig"
          />
        </div>
        <span v-else class="lsp-modal__ok">✓ Added to workspace config</span>
      </template>

      <!-- Not installed: show install options -->
      <template v-if="!lang.alreadyInstalled && !installed">
        <template v-if="lang.installOptions.length">
          <div class="lsp-modal__options-row">
            <label class="lsp-modal__options-label">Install via</label>
            <Select
              v-model="selectedOption"
              :options="lang.installOptions"
              optionLabel="label"
              class="lsp-modal__select"
            />
          </div>
          <div class="lsp-modal__action-row">
            <Button
              label="Install"
              icon="pi pi-download"
              :loading="running"
              :disabled="!selectedOption || running"
              @click="install"
            />
          </div>
        </template>
        <template v-else>
          <p class="lsp-modal__hint">
            No automatic install available. Install
            <code>{{ lang.entry.serverName }}</code> manually, then add it to config.
          </p>
          <div v-if="!added" class="lsp-modal__action-row">
            <Button
              label="Add to workspace config"
              icon="pi pi-file-edit"
              :loading="adding"
              @click="addToConfig"
            />
          </div>
          <span v-else class="lsp-modal__ok">✓ Added to workspace config</span>
        </template>
      </template>

      <!-- Install output — shown as soon as lines arrive -->
      <pre v-if="output || running" class="lsp-modal__output" ref="outputEl">{{ output || ' ' }}</pre>

      <!-- Installed: offer add to config -->
      <template v-if="installed && !added">
        <p class="lsp-modal__hint">Installation complete. Adding to workspace config…</p>
        <span class="lsp-modal__ok">✓ Added to workspace config</span>
      </template>
    </div>

    <template #footer>
      <Button label="Cancel" severity="secondary" text @click="emit('cancel')" />
      <Button
        v-if="isDone"
        label="Done"
        icon="pi pi-check"
        @click="emit('done')"
      />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import Tag from "primevue/tag";
import Select from "primevue/select";
import { api, onInstallLine } from "../rpc";
import type { LspDetectedLanguage, LspInstallOption } from "../../shared/rpc-types";

const props = defineProps<{
  lang: LspDetectedLanguage;
  projectKey: string;
  projectPath: string;
  workspaceKey: string;
}>();

const emit = defineEmits<{
  done: [];
  cancel: [];
}>();

const selectedOption = ref<LspInstallOption | undefined>(props.lang.installOptions[0]);
const running = ref(false);
const installed = ref(false);
const hasError = ref(false);
const output = ref("");
const outputEl = ref<HTMLPreElement | null>(null);
const adding = ref(false);
const added = ref(props.lang.inConfig);

watch(
  () => props.lang,
  (lang) => {
    selectedOption.value = lang.installOptions[0];
    added.value = lang.inConfig;
  },
);

const isDone = computed(
  () => (props.lang.alreadyInstalled || installed.value) && added.value,
);

function scrollOutput() {
  nextTick(() => {
    if (outputEl.value) outputEl.value.scrollTop = outputEl.value.scrollHeight;
  });
}

async function install() {
  const option = selectedOption.value;
  if (!option || running.value) return;
  running.value = true;
  hasError.value = false;
  output.value = "";

  // Generate a correlation token and subscribe to streaming lines
  const token = crypto.randomUUID();
  const unsubscribe = onInstallLine(token, (line) => {
    output.value += (output.value ? "\n" : "") + line;
    scrollOutput();
  });

  try {
    const result = await api("lsp.runInstall", {
      command: option.command,
      projectPath: props.projectPath,
      workspaceKey: props.workspaceKey,
      token,
    });
    // Ensure full output is shown (in case any lines were missed)
    if (result.output) output.value = result.output;
    scrollOutput();
    if (result.success) {
      installed.value = true;
      await addToConfig();
    } else {
      hasError.value = true;
    }
  } catch (e) {
    output.value = e instanceof Error ? e.message : String(e);
    hasError.value = true;
  } finally {
    unsubscribe();
    running.value = false;
  }
}

async function addToConfig() {
  adding.value = true;
  try {
    await api("lsp.addToConfig", {
      projectPath: props.projectPath,
      languageServerName: props.lang.entry.serverName,
      workspaceKey: props.workspaceKey,
      projectKey: props.projectKey,
    });
    added.value = true;
  } finally {
    adding.value = false;
  }
}
</script>

<style scoped>
.lsp-modal {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.lsp-modal__status-row {
  display: flex;
  gap: 8px;
}

.lsp-modal__hint {
  font-size: 0.875rem;
  color: var(--p-text-muted-color, #64748b);
  margin: 0;
}

.lsp-modal__options-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.lsp-modal__options-label {
  font-size: 0.875rem;
  white-space: nowrap;
}

.lsp-modal__select {
  flex: 1;
}

.lsp-modal__action-row {
  display: flex;
}

.lsp-modal__ok {
  font-size: 0.875rem;
  color: var(--p-green-500, #22c55e);
  font-weight: 500;
}

.lsp-modal__output {
  font-size: 0.78rem;
  background: var(--p-surface-900, #0f172a);
  color: var(--p-surface-100, #f1f5f9);
  border-radius: 6px;
  padding: 8px 12px;
  max-height: 180px;
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-all;
  margin: 0;
}
</style>
