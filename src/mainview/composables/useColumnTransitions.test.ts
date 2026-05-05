import { describe, it, expect } from "vitest";
import { ref } from "vue";
import { getValidTransitionColumns, useColumnTransitions } from "./useColumnTransitions";
import type { WorkflowTemplate } from "../../shared/rpc-types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTemplate(cols: Array<{ id: string; allowedTransitions?: string[] }>): WorkflowTemplate {
  return {
    id: "test",
    name: "Test",
    columns: cols.map((c) => ({ label: c.id, ...c })),
  } as WorkflowTemplate;
}

const FIVE_COL = makeTemplate([
  { id: "backlog" },
  { id: "plan" },
  { id: "in_progress" },
  { id: "in_review" },
  { id: "done" },
]);

const RESTRICTED = makeTemplate([
  { id: "backlog", allowedTransitions: ["plan"] },
  { id: "plan" },
  { id: "in_progress" },
  { id: "in_review" },
  { id: "done" },
]);

// ─── getValidTransitionColumns ────────────────────────────────────────────────

describe("getValidTransitionColumns", () => {
  // GCT-1
  it("GCT-1: returns all columns with current disabled when allowedTransitions is undefined", () => {
    const result = getValidTransitionColumns(FIVE_COL, "backlog");
    expect(result).toHaveLength(5);
    expect(result.find((c) => c.id === "backlog")?.disabled).toBe(true);
    expect(result.filter((c) => c.id !== "backlog").every((c) => !c.disabled)).toBe(true);
  });

  // GCT-2
  it("GCT-2: returns only current column disabled when allowedTransitions is empty", () => {
    const tmpl = makeTemplate([
      { id: "backlog", allowedTransitions: [] },
      { id: "plan" },
    ]);
    const result = getValidTransitionColumns(tmpl, "backlog");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("backlog");
    expect(result[0].disabled).toBe(true);
  });

  // GCT-3
  it("GCT-3: returns current plus allowed targets only", () => {
    const tmpl = makeTemplate([
      { id: "backlog", allowedTransitions: ["plan", "done"] },
      { id: "plan" },
      { id: "in_progress" },
      { id: "in_review" },
      { id: "done" },
    ]);
    const result = getValidTransitionColumns(tmpl, "backlog");
    expect(result).toHaveLength(3);
    expect(result.map((c) => c.id)).toEqual(["backlog", "plan", "done"]);
    expect(result[0].disabled).toBe(true);
    expect(result[1].disabled).toBe(false);
    expect(result[2].disabled).toBe(false);
  });

  // GCT-4
  it("GCT-4: returns empty array when template is undefined", () => {
    expect(getValidTransitionColumns(undefined, "backlog")).toEqual([]);
  });

  // GCT-5
  it("GCT-5: returns empty array when fromColumnId is not found in template", () => {
    expect(getValidTransitionColumns(FIVE_COL, "ghost-column")).toEqual([]);
  });

  // GCT-6
  it("GCT-6: returns empty array when fromColumnId is null", () => {
    expect(getValidTransitionColumns(FIVE_COL, null)).toEqual([]);
  });

  it("GCT-6b: returns empty array when fromColumnId is undefined", () => {
    expect(getValidTransitionColumns(FIVE_COL, undefined)).toEqual([]);
  });

  // GCT-7
  it("GCT-7: result order follows template column order even when allowedTransitions is out of order", () => {
    const tmpl = makeTemplate([
      { id: "backlog", allowedTransitions: ["done", "plan"] },
      { id: "plan" },
      { id: "in_progress" },
      { id: "done" },
    ]);
    const result = getValidTransitionColumns(tmpl, "backlog");
    expect(result.map((c) => c.id)).toEqual(["backlog", "plan", "done"]);
  });

  // GCT-8
  it("GCT-8: unknown column IDs in allowedTransitions are silently dropped", () => {
    const tmpl = makeTemplate([
      { id: "backlog", allowedTransitions: ["plan", "ghost-col"] },
      { id: "plan" },
    ]);
    const result = getValidTransitionColumns(tmpl, "backlog");
    expect(result.map((c) => c.id)).toEqual(["backlog", "plan"]);
  });

  // GCT-9
  it("GCT-9: single-column template with empty allowedTransitions returns that column disabled", () => {
    const tmpl = makeTemplate([{ id: "only", allowedTransitions: [] }]);
    const result = getValidTransitionColumns(tmpl, "only");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("only");
    expect(result[0].disabled).toBe(true);
  });
});

// ─── useColumnTransitions ─────────────────────────────────────────────────────

describe("useColumnTransitions", () => {
  // UCT-1
  it("UCT-1: forbiddenColumnIds is empty when allowedTransitions is undefined", () => {
    const { forbiddenColumnIds } = useColumnTransitions(ref(FIVE_COL), ref("backlog"));
    expect(forbiddenColumnIds.value.size).toBe(0);
  });

  // UCT-2
  it("UCT-2: forbiddenColumnIds contains non-reachable columns", () => {
    const { forbiddenColumnIds } = useColumnTransitions(ref(RESTRICTED), ref("backlog"));
    expect(forbiddenColumnIds.value.has("in_progress")).toBe(true);
    expect(forbiddenColumnIds.value.has("in_review")).toBe(true);
    expect(forbiddenColumnIds.value.has("done")).toBe(true);
    expect(forbiddenColumnIds.value.has("plan")).toBe(false);
    expect(forbiddenColumnIds.value.has("backlog")).toBe(false);
  });

  // UCT-3
  it("UCT-3: selectableColumns matches getValidTransitionColumns output", () => {
    const { selectableColumns } = useColumnTransitions(ref(RESTRICTED), ref("backlog"));
    expect(selectableColumns.value).toEqual(getValidTransitionColumns(RESTRICTED, "backlog"));
  });

  // UCT-4
  it("UCT-4: selectableColumns updates reactively when currentColumnId changes", () => {
    const colIdRef = ref<string | null>("backlog");
    const { selectableColumns } = useColumnTransitions(ref(RESTRICTED), colIdRef);

    // backlog has allowedTransitions: ["plan"] → 2 options
    expect(selectableColumns.value).toHaveLength(2);

    // plan has no allowedTransitions → all 5 options
    colIdRef.value = "plan";
    expect(selectableColumns.value).toHaveLength(5);
  });
});
