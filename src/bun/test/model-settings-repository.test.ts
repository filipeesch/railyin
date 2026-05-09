/**
 * model-settings-repository.test.ts
 *
 * Integration tests for SqliteModelSettingsRepository.
 * All tests run against an in-memory SQLite DB that includes the model_settings table.
 *
 * MSR-1  getContextWindow returns null when no row exists
 * MSR-2  setContextWindow stores a value, getContextWindow returns it
 * MSR-3  setContextWindow(null) removes the row — getContextWindow returns null again
 * MSR-4  setContextWindow upserts — calling twice with different values updates in place
 * MSR-5  Idempotent — calling twice with same value does not throw
 * MSR-6  Workspace keys are isolated — setting on ws-A does not affect ws-B
 * MSR-7  Model IDs are isolated within the same workspace
 */

import { describe, it, expect, beforeEach } from "vitest";
import type { Database } from "bun:sqlite";
import { initDb } from "./helpers.ts";
import { SqliteModelSettingsRepository } from "../db/repositories/model-settings-repository.ts";

const WK = "default";
const MODEL_A = "pi/llama-3.3-70b";
const MODEL_B = "pi/mistral-7b";
const WK_B = "workspace-b";

let db: Database;
let repo: SqliteModelSettingsRepository;

beforeEach(() => {
  db = initDb();
  repo = new SqliteModelSettingsRepository(db);
});

// ─── MSR-1 ───────────────────────────────────────────────────────────────────

describe("MSR-1: getContextWindow returns null for unknown entry", () => {
  it("returns null when no row exists for the workspace+model pair", () => {
    expect(repo.getContextWindow(WK, MODEL_A)).toBeNull();
  });
});

// ─── MSR-2 ───────────────────────────────────────────────────────────────────

describe("MSR-2: setContextWindow stores value, getContextWindow retrieves it", () => {
  it("stores 65536 and retrieves 65536", () => {
    repo.setContextWindow(WK, MODEL_A, 65536);
    expect(repo.getContextWindow(WK, MODEL_A)).toBe(65536);
  });

  it("stores 128000 and retrieves 128000", () => {
    repo.setContextWindow(WK, MODEL_A, 128_000);
    expect(repo.getContextWindow(WK, MODEL_A)).toBe(128_000);
  });
});

// ─── MSR-3 ───────────────────────────────────────────────────────────────────

describe("MSR-3: setContextWindow(null) removes the override", () => {
  it("returns null after storing a value then passing null", () => {
    repo.setContextWindow(WK, MODEL_A, 65536);
    expect(repo.getContextWindow(WK, MODEL_A)).toBe(65536);

    repo.setContextWindow(WK, MODEL_A, null);
    expect(repo.getContextWindow(WK, MODEL_A)).toBeNull();
  });

  it("calling null on a non-existent row does not throw", () => {
    expect(() => repo.setContextWindow(WK, MODEL_A, null)).not.toThrow();
    expect(repo.getContextWindow(WK, MODEL_A)).toBeNull();
  });
});

// ─── MSR-4 ───────────────────────────────────────────────────────────────────

describe("MSR-4: setContextWindow upserts — second call updates the row", () => {
  it("overrides the previous value with the new one", () => {
    repo.setContextWindow(WK, MODEL_A, 32_768);
    repo.setContextWindow(WK, MODEL_A, 200_000);
    expect(repo.getContextWindow(WK, MODEL_A)).toBe(200_000);
  });

  it("row count stays at 1 after two sets for the same pair", () => {
    repo.setContextWindow(WK, MODEL_A, 32_768);
    repo.setContextWindow(WK, MODEL_A, 64_000);
    const count = db
      .query<{ n: number }, [string, string]>(
        "SELECT COUNT(*) as n FROM model_settings WHERE workspace_key = ? AND qualified_model_id = ?",
      )
      .get(WK, MODEL_A)!.n;
    expect(count).toBe(1);
  });
});

// ─── MSR-5 ───────────────────────────────────────────────────────────────────

describe("MSR-5: setContextWindow is idempotent with same value", () => {
  it("calling twice with the same value does not throw and returns the same value", () => {
    repo.setContextWindow(WK, MODEL_A, 128_000);
    expect(() => repo.setContextWindow(WK, MODEL_A, 128_000)).not.toThrow();
    expect(repo.getContextWindow(WK, MODEL_A)).toBe(128_000);
  });
});

// ─── MSR-6 ───────────────────────────────────────────────────────────────────

describe("MSR-6: workspace keys are isolated", () => {
  it("override on workspace-a does not appear on workspace-b", () => {
    repo.setContextWindow(WK, MODEL_A, 65536);
    expect(repo.getContextWindow(WK_B, MODEL_A)).toBeNull();
  });

  it("each workspace can have an independent override for the same model", () => {
    repo.setContextWindow(WK, MODEL_A, 65536);
    repo.setContextWindow(WK_B, MODEL_A, 200_000);
    expect(repo.getContextWindow(WK, MODEL_A)).toBe(65536);
    expect(repo.getContextWindow(WK_B, MODEL_A)).toBe(200_000);
  });
});

// ─── MSR-7 ───────────────────────────────────────────────────────────────────

describe("MSR-7: model IDs are isolated within the same workspace", () => {
  it("override on model-A does not affect model-B", () => {
    repo.setContextWindow(WK, MODEL_A, 65536);
    expect(repo.getContextWindow(WK, MODEL_B)).toBeNull();
  });

  it("each model can have an independent override within the same workspace", () => {
    repo.setContextWindow(WK, MODEL_A, 65536);
    repo.setContextWindow(WK, MODEL_B, 32_768);
    expect(repo.getContextWindow(WK, MODEL_A)).toBe(65536);
    expect(repo.getContextWindow(WK, MODEL_B)).toBe(32_768);
  });
});
