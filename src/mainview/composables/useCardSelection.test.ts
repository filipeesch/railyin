import { describe, it, expect } from "vitest";
import { useCardSelection } from "./useCardSelection";

describe("useCardSelection", () => {

  it("starts with selection mode off and no selected ids", () => {
    const { isSelectionMode, selectedCount, selectedIds } = useCardSelection();

    expect(isSelectionMode.value).toBe(false);
    expect(selectedCount.value).toBe(0);
    expect(selectedIds.value.size).toBe(0);
  });

  it("enterSelectionMode activates selection mode without changing selection", () => {
    const { isSelectionMode, selectedCount, enterSelectionMode } = useCardSelection();

    enterSelectionMode();

    expect(isSelectionMode.value).toBe(true);
    expect(selectedCount.value).toBe(0);
  });

  it("toggleSelection adds and removes ids", () => {
    const { selectedIds, selectedCount, toggleSelection, isSelected } = useCardSelection();

    toggleSelection(1);
    expect(selectedIds.value.has(1)).toBe(true);
    expect(selectedCount.value).toBe(1);
    expect(isSelected(1)).toBe(true);

    toggleSelection(2);
    expect(selectedCount.value).toBe(2);

    toggleSelection(1);
    expect(selectedIds.value.has(1)).toBe(false);
    expect(selectedCount.value).toBe(1);
    expect(isSelected(1)).toBe(false);
  });

  it("clearSelection empties the set without exiting selection mode", () => {
    const { isSelectionMode, selectedCount, enterSelectionMode, toggleSelection, clearSelection } = useCardSelection();

    enterSelectionMode();
    toggleSelection(1);
    toggleSelection(2);
    expect(selectedCount.value).toBe(2);

    clearSelection();

    expect(isSelectionMode.value).toBe(true);
    expect(selectedCount.value).toBe(0);
  });

  it("exitSelectionMode clears selection and turns off selection mode", () => {
    const { isSelectionMode, selectedCount, enterSelectionMode, toggleSelection, exitSelectionMode } = useCardSelection();

    enterSelectionMode();
    toggleSelection(1);
    exitSelectionMode();

    expect(isSelectionMode.value).toBe(false);
    expect(selectedCount.value).toBe(0);
  });
});
