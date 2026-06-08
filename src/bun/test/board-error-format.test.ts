/**
 * board-error-format.test.ts — Unit tests for buildBoardNotFoundError
 *
 * Suites:
 *   EF-1  Formats board list with multiple boards (2 scenarios)
 *   EF-2  Returns no boards message for empty array (1 scenario)
 *   EF-3  Handles special characters in board names (1 scenario)
 *   EF-4  Deterministic output / idempotency (1 scenario)
 */
import { describe, it, expect } from "vitest";
import { buildBoardNotFoundError } from "../workflow/tools/board-error-format.ts";

describe("EF-1: Formats board list with multiple boards", () => {
  it("formats two boards", () => {
    const result = buildBoardNotFoundError([
      { id: 1, name: "Board A" },
      { id: 2, name: "Board B" },
    ]);
    expect(result).toContain("Available boards:");
    expect(result).toContain('Board #1: "Board A"');
    expect(result).toContain('Board #2: "Board B"');
  });

  it("formats single board", () => {
    const result = buildBoardNotFoundError([{ id: 1, name: "Only Board" }]);
    expect(result).toContain("Available boards:");
    expect(result).toContain('Board #1: "Only Board"');
  });
});

describe("EF-2: Returns no boards message for empty array", () => {
  it("returns no boards available message", () => {
    const result = buildBoardNotFoundError([]);
    expect(result).toContain("No boards are currently available");
  });
});

describe("EF-3: Handles special characters in board names", () => {
  it("handles quotes in board names", () => {
    expect(() =>
      buildBoardNotFoundError([{ id: 1, name: 'Board "Special"' }]),
    ).not.toThrow();
  });
});

describe("EF-4: Deterministic output / idempotency", () => {
  it("same input produces same output", () => {
    const boards = [{ id: 1, name: "Test" }];
    const result1 = buildBoardNotFoundError(boards);
    const result2 = buildBoardNotFoundError(boards);
    expect(result1).toBe(result2);
  });
});
