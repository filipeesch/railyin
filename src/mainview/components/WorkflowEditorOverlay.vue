<template>
  <FileEditorOverlay
    :visible="props.visible"
    :title="`Edit Workflow: ${props.templateName}`"
    :content="props.initialYaml"
    language="yaml"
    note="Changes apply to all boards using this template in the current workspace."
    save-label="Save & Reload"
    save-icon="pi pi-save"
    @close="emit('close')"
    @save="onSave"
  />
</template>

<script setup lang="ts">
import FileEditorOverlay from "./FileEditorOverlay.vue";
import { api } from "../rpc";

const props = defineProps<{
  visible: boolean;
  workspaceKey?: string;
  templateId: string;
  templateName: string;
  initialYaml: string;
}>();

const emit = defineEmits<{
  close: [];
  saved: [];
}>();

async function onSave(content: string) {
  await api("workflow.saveYaml", {
    workspaceKey: props.workspaceKey,
    templateId: props.templateId,
    yaml: content,
  });
  emit("saved");
  emit("close");
}
</script>
