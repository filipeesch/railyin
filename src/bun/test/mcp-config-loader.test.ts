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

  // Regression test for a real-world gap: a statically-configured OAuth
  // client_id (for authorization servers like Keycloak that reject anonymous
  // Dynamic Client Registration) was previously silently dropped by the
  // config loader since `auth` wasn't part of the http transport shape.
  it("passes through the auth.client_id override on an http entry", () => {
    const input = {
      servers: {
        langfuse: {
          url: "https://observability-mcp.example.com/mcp",
          auth: { client_id: "observability-mcp", client_secret: "shh" },
        },
      },
    };
    const result = normalizeToMcpConfig(input);
    const server = result.servers[0];
    expect(server.transport.type).toBe("http");
    if (server.transport.type === "http") {
      expect(server.transport.auth).toEqual({ client_id: "observability-mcp", client_secret: "shh" });
    }
  });

  it("leaves auth undefined when not configured on an http entry", () => {
    const input = { servers: { remoteApi: { url: "https://api.example.com/mcp" } } };
    const result = normalizeToMcpConfig(input);
    const server = result.servers[0];
    expect(server.transport.type).toBe("http");
    if (server.transport.type === "http") {
      expect(server.transport.auth).toBeUndefined();
    }
  });

  // Regression test for a real-world bug: a user hand-edited mcp.json with
  // `CLIENT_ID` (env-var-style casing) instead of the JSON-conventional
  // `client_id` — the loader silently dropped it, leaving Dynamic Client
  // Registration to run (and be rejected with a 403 by their Keycloak realm)
  // instead of using the intended static override.
  it("accepts CLIENT_ID (uppercase, env-var-style casing) as a client_id alias", () => {
    const input = {
      servers: {
        langfuse: {
          url: "https://observability-mcp.example.com/mcp",
          auth: { CLIENT_ID: "observability-mcp" },
        },
      },
    };
    const result = normalizeToMcpConfig(input);
    const server = result.servers[0];
    expect(server.transport.type).toBe("http");
    if (server.transport.type === "http") {
      expect(server.transport.auth).toEqual({ client_id: "observability-mcp" });
    }
  });

  it("accepts clientId/clientSecret (camelCase) as aliases", () => {
    const input = {
      servers: {
        langfuse: {
          url: "https://observability-mcp.example.com/mcp",
          auth: { clientId: "observability-mcp", clientSecret: "shh" },
        },
      },
    };
    const result = normalizeToMcpConfig(input);
    const server = result.servers[0];
    expect(server.transport.type).toBe("http");
    if (server.transport.type === "http") {
      expect(server.transport.auth).toEqual({ client_id: "observability-mcp", client_secret: "shh" });
    }
  });

  it("treats an auth object with no recognized client_id key as absent (falls back to DCR)", () => {
    const input = {
      servers: {
        langfuse: {
          url: "https://observability-mcp.example.com/mcp",
          auth: { someOtherKey: "irrelevant" },
        },
      },
    };
    const result = normalizeToMcpConfig(input);
    const server = result.servers[0];
    expect(server.transport.type).toBe("http");
    if (server.transport.type === "http") {
      expect(server.transport.auth).toBeUndefined();
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

  // Regression test for a pre-existing bug: the object-map branch built only
  // { name, transport }, silently dropping `description`/`enabled` even though
  // McpServerConfig supports both and the array-format branch preserves them.
  // This matters for list_mcp_servers (mcp-tool-discovery), which needs
  // `description` to be reliable regardless of config authoring style.
  it("preserves description on an object-map entry", () => {
    const input = {
      servers: {
        docs: { command: "docs-server", description: "Internal documentation search" },
      },
    };
    const result = normalizeToMcpConfig(input);
    expect(result.servers[0].description).toBe("Internal documentation search");
  });

  it("preserves enabled: false on an object-map entry", () => {
    const input = {
      servers: {
        legacy: { command: "legacy-server", enabled: false },
      },
    };
    const result = normalizeToMcpConfig(input);
    expect(result.servers[0].enabled).toBe(false);
  });

  it("leaves description/enabled undefined when not present on an object-map entry", () => {
    const input = { servers: { plain: { command: "plain-server" } } };
    const result = normalizeToMcpConfig(input);
    expect(result.servers[0].description).toBeUndefined();
    expect(result.servers[0].enabled).toBeUndefined();
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

  it("preserves description and enabled from an object-map format file", () => {
    const filePath = join(tempDir, "mcp.json");
    const content = JSON.stringify({
      servers: {
        myTool: { command: "tool", description: "My internal tool", enabled: false },
      },
    });
    writeFileSync(filePath, content, "utf-8");

    const result = loadMcpConfigFile(filePath);
    expect(result.servers[0].description).toBe("My internal tool");
    expect(result.servers[0].enabled).toBe(false);
  });
});
