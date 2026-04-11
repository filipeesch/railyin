<template>
  <Dialog
    v-model:visible="visible"
    header="Manage Models"
    :modal="true"
    :style="{ width: '560px', maxHeight: '70vh' }"
    :dismissable-mask="true"
    @hide="emit('close')"
  >
    <div class="manage-models-body">
      <ModelTreeView :workspace-id="props.workspaceId" />
    </div>

    <template #footer>
      <Button label="Done" @click="close" />
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import Dialog from "primevue/dialog";
import Button from "primevue/button";
import ModelTreeView from "./ModelTreeView.vue";

const props = defineProps<{ modelValue: boolean; workspaceId?: number }>();
const emit = defineEmits<{ (e: "update:modelValue", v: boolean): void; (e: "close"): void }>();

const visible = ref(props.modelValue);

watch(
  () => props.modelValue,
  (v) => { visible.value = v; },
);

watch(visible, (v) => {
  emit("update:modelValue", v);
});

function close() {
  visible.value = false;
  emit("close");
}
</script>

<style scoped>
.manage-models-body {
  overflow-y: auto;
  max-height: calc(70vh - 120px);
}
</style>
