import type { WorkflowColumn, WorkflowTemplate } from "../../shared/rpc-types";
import { computed, type MaybeRef, toValue, type ComputedRef } from "vue";

export interface TransitionColumn extends WorkflowColumn {
  disabled: boolean;
}

export function getValidTransitionColumns(
  template: WorkflowTemplate | undefined,
  fromColumnId: string | null | undefined,
): TransitionColumn[] {
  if (!template) return [];
  if (fromColumnId == null) return [];

  const fromCol = template.columns.find((c) => c.id === fromColumnId);
  if (!fromCol) return [];

  if (fromCol.allowedTransitions === undefined) {
    return template.columns.map((col) => ({ ...col, disabled: col.id === fromColumnId }));
  }

  if (fromCol.allowedTransitions.length === 0) {
    return [{ ...fromCol, disabled: true }];
  }

  const allowed = new Set(fromCol.allowedTransitions);
  return template.columns
    .filter((col) => col.id === fromColumnId || allowed.has(col.id))
    .map((col) => ({ ...col, disabled: col.id === fromColumnId }));
}

export function useColumnTransitions(
  template: MaybeRef<WorkflowTemplate | undefined>,
  currentColumnId: MaybeRef<string | null | undefined>,
): {
  selectableColumns: ComputedRef<TransitionColumn[]>;
  forbiddenColumnIds: ComputedRef<Set<string>>;
} {
  const selectableColumns = computed(() =>
    getValidTransitionColumns(toValue(template), toValue(currentColumnId)),
  );

  const forbiddenColumnIds = computed(() => {
    const colId = toValue(currentColumnId);
    if (!colId) return new Set<string>();
    const tmpl = toValue(template);
    if (!tmpl) return new Set<string>();
    const fromCol = tmpl.columns.find((c) => c.id === colId);
    if (!fromCol || fromCol.allowedTransitions === undefined) return new Set<string>();
    const selectableIds = new Set(selectableColumns.value.map((c) => c.id));
    return new Set(tmpl.columns.map((c) => c.id).filter((id) => id !== colId && !selectableIds.has(id)));
  });

  return { selectableColumns, forbiddenColumnIds };
}
