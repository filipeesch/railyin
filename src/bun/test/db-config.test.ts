import { describe, it, expect } from "vitest";
import { resolveDbConfig } from "../db/db-config.ts";

describe("resolveDbConfig (PC-1)", () => {
  it("DC-1: absent config file + no RAILYN_DB defaults to SQLite at the default path", () => {
    const config = resolveDbConfig({}, null, "/data/railyn.db");
    expect(config).toEqual({ driver: "sqlite", path: "/data/railyn.db" });
  });

  it("DC-2: empty config file content also defaults to SQLite", () => {
    const config = resolveDbConfig({}, "", "/data/railyn.db");
    expect(config.driver).toBe("sqlite");
  });

  it("DC-3: driver: postgres resolves to its URL", () => {
    const config = resolveDbConfig(
      {},
      "driver: postgres\npostgres:\n  url: postgres://u:p@host:5432/db\n",
      "/data/railyn.db",
    );
    expect(config).toEqual({ driver: "postgres", url: "postgres://u:p@host:5432/db" });
  });

  it("DC-4: driver: sqlite with explicit path", () => {
    const config = resolveDbConfig({}, "driver: sqlite\nsqlite:\n  path: /custom/app.db\n", "/data/railyn.db");
    expect(config).toEqual({ driver: "sqlite", path: "/custom/app.db" });
  });

  it("DC-5: driver: sqlite with no path block falls back to the default path", () => {
    const config = resolveDbConfig({}, "driver: sqlite\n", "/data/railyn.db");
    expect(config).toEqual({ driver: "sqlite", path: "/data/railyn.db" });
  });

  it("DC-6: unknown driver value throws a descriptive error", () => {
    expect(() => resolveDbConfig({}, "driver: mysql\n", "/x")).toThrow(/invalid "driver"/);
  });

  it("DC-7: postgres driver with no postgres block throws", () => {
    expect(() => resolveDbConfig({}, "driver: postgres\n", "/x")).toThrow(/postgres\.url/);
  });

  it("DC-8: postgres driver with empty url throws", () => {
    expect(() => resolveDbConfig({}, "driver: postgres\npostgres:\n  url: ''\n", "/x")).toThrow(/postgres\.url/);
  });

  it("DC-9: RAILYN_DB env overrides a present postgres config", () => {
    const config = resolveDbConfig(
      { RAILYN_DB: ":memory:" },
      "driver: postgres\npostgres:\n  url: postgres://u@h/db\n",
      "/data/railyn.db",
    );
    expect(config).toEqual({ driver: "sqlite", path: ":memory:" });
  });

  it("DC-10: RAILYN_DB env used when no config file present", () => {
    const config = resolveDbConfig({ RAILYN_DB: "/tmp/x.db" }, null, "/data/railyn.db");
    expect(config).toEqual({ driver: "sqlite", path: "/tmp/x.db" });
  });

  it("DC-11: malformed YAML throws a descriptive parse error, not a crash", () => {
    expect(() => resolveDbConfig({}, "driver: [postgres\n  bad: yaml:::", "/x")).toThrow(/Failed to parse database\.yaml/);
  });

  it("DC-12: partial pool block (max only) is accepted", () => {
    const config = resolveDbConfig(
      {},
      "driver: postgres\npostgres:\n  url: postgres://u@h/db\n  pool:\n    max: 10\n",
      "/x",
    );
    expect(config).toEqual({ driver: "postgres", url: "postgres://u@h/db", pool: { max: 10 } });
  });

  it("DC-13: full pool block (max + idleTimeout)", () => {
    const config = resolveDbConfig(
      {},
      "driver: postgres\npostgres:\n  url: postgres://u@h/db\n  pool:\n    max: 10\n    idleTimeout: 30\n",
      "/x",
    );
    expect(config).toEqual({ driver: "postgres", url: "postgres://u@h/db", pool: { max: 10, idleTimeout: 30 } });
  });

  it("DC-14: ${VAR} in postgres.url is expanded from the injected env", () => {
    const config = resolveDbConfig(
      { DB_PASSWORD: "secret" },
      "driver: postgres\npostgres:\n  url: postgres://u:${DB_PASSWORD}@h/db\n",
      "/x",
    );
    expect(config).toEqual({ driver: "postgres", url: "postgres://u:secret@h/db" });
  });

  it("DC-15: ${VAR} referencing an unset env var throws a clear error", () => {
    expect(() =>
      resolveDbConfig({}, "driver: postgres\npostgres:\n  url: postgres://u:${MISSING}@h/db\n", "/x"),
    ).toThrow(/MISSING/);
  });
});
