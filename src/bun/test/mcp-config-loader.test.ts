import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { normalizeToMcpConfig, loadMcpConfigFile } from "../mcp/config-loader.ts";

describe("normalizeToMcpConfig", () => {
  it("returns empty servers for null input", () => {
    expect(normalizeToMcpConfig(null)).toEqual({ servers: [] });
  });

  it("returns empty servers for empty object (no servers key)", () => {
    expect(normalizeToMcpConfig({})).toEqual({ servers: [] });
  });

  it("passes through array-format servers unchanged", () => {
    const input = {
      servers: [
        { name: "docs", transport: { type: "http", url: "http://localhost:3100" } },
        { name: "shell", transport: { type: "stdio", command: "sh", args: ["-c", "echo ok"] } },
      ],
    };
    const result = normalizeToMcpConfig(input);
    expect(result.servers).toHaveLength(2);
    expect(result.servers[0].name).toBe("docs");
    expect(result.servers[1].name).toBe("shell");
  });

  it("converts VS Code object-map format with stdio entry", () => {
    const input = {
      servers: {
        myServer: {
          command: "node",
          args: ["server.js"],
          env: { NODE_ENV: "test" },
        },
      },
    };
    const result = normalizeToMcpConfig(input);
    expect(result.servers).toHaveLength(1);
    const server = result.servers[0];
    expect(server.name).toBe("myServer");
    expect(server.transport.type).toBe("stdio");
    if (server.transport.type === "stdio") {
      expect(server.transport.command).toBe("node");
      expect(server.transport.args).toEqual(["server.js"]);
      expect(server.transport.env).toEqual({ NODE_ENV: "test" });
    }
  });

  it("converts VS Code object-map format with http entry and headers", () => {
    const input = {
      servers: {
        remoteApi: {
          url: "https://api.example.com/mcp",
          headers: { Authorization: "Bearer token" },
        },
      },
    };
    const result = normalizeToMcpConfig(input);
    expect(result.servers).toHaveLength(1);
    const server = result.servers[0];
    expect(server.name).toBe("remoteApi");
    expect(server.transport.type).toBe("http");
    if (server.transport.type === "http") {
      expect(server.transport.url).toBe("https://api.example.com/mcp");
      expect(server.transport.headers).toEqual({ Authorization: "Bearer token" });
    }
  });

  it("converts multiple servers from VS Code object-map", () => {
    const input = {
      servers: {
        first: { command: "first-cmd" },
        second: { url: "http://second" },
        third: { command: "third-cmd", args: ["--verbose"] },
      },
    };
    const result = normalizeToMcpConfig(input);
    expect(result.servers).toHaveLength(3);
    expect(result.servers.map((s) => s.name)).toEqual(["first", "second", "third"]);
  });
});

describe("loadMcpConfigFile", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "railyn-config-loader-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("returns empty config when file does not exist", () => {
    const result = loadMcpConfigFile(join(tempDir, "nonexistent.json"));
    expect(result).toEqual({ servers: [] });
  });

  it("parses and normalizes a valid JSON config file", () => {
    const filePath = join(tempDir, "mcp.json");
    const content = JSON.stringify({
      servers: [{ name: "test", transport: { type: "stdio", command: "echo" } }],
    });
    writeFileSync(filePath, content, "utf-8");

    const result = loadMcpConfigFile(filePath);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].name).toBe("test");
  });

  it("throws SyntaxError for malformed JSON", () => {
    const filePath = join(tempDir, "bad.json");
    writeFileSync(filePath, "{ not valid json }", "utf-8");

    expect(() => loadMcpConfigFile(filePath)).toThrow(SyntaxError);
  });

  it("handles VS Code object-map format from file", () => {
    const filePath = join(tempDir, "mcp.json");
    const content = JSON.stringify({
      servers: {
        myTool: { command: "tool", args: ["--mode=mcp"] },
      },
    });
    writeFileSync(filePath, content, "utf-8");

    const result = loadMcpConfigFile(filePath);
    expect(result.servers).toHaveLength(1);
    expect(result.servers[0].name).toBe("myTool");
    expect(result.servers[0].transport.type).toBe("stdio");
  });
});
