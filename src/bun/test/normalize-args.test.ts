import { describe, expect, it } from "bun:test";
import { normalizeToolArguments } from "../../bun/engine/normalize-args.ts";

describe("normalizeToolArguments", () => {
  describe("string-encoded arrays", () => {
    it("parses valid JSON string into array for type: array", () => {
      const schema = {
        properties: {
          items: { type: "array", description: "An array of items" },
        },
      };
      const args = { items: '[{"id": 1}, {"id": 2}]' };
      const result = normalizeToolArguments(schema as any, args as any);
      expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
      expect(Array.isArray(result.items)).toBe(true);
    });

    it("leaves non-string array values unchanged", () => {
      const schema = {
        properties: {
          items: { type: "array" },
        },
      };
      const args = { items: [{ id: 1 }, { id: 2 }] };
      const result = normalizeToolArguments(schema as any, args as any);
      expect(result.items).toEqual([{ id: 1 }, { id: 2 }]);
    });

    it("catches invalid JSON and preserves original string", () => {
      const schema = {
        properties: {
          data: { type: "array" },
        },
      };
      const args = { data: "[invalid json" };
      const result = normalizeToolArguments(schema as any, args as any);
      expect(result.data).toBe("[invalid json");
    });
  });

  describe("string-encoded objects", () => {
    it("parses valid JSON string into object for type: object", () => {
      const schema = {
        properties: {
          options: { type: "object" },
        },
      };
      const args = { options: '{"title": "Hello", "count": 42}' };
      const result = normalizeToolArguments(schema as any, args as any);
      expect(result.options).toEqual({ title: "Hello", count: 42 });
      expect(typeof result.options).toBe("object");
      expect(Array.isArray(result.options)).toBe(false);
    });

    it("leaves non-string object values unchanged", () => {
      const schema = {
        properties: {
          metadata: { type: "object" },
        },
      };
      const nativeObj = { key: "value" };
      const args = { metadata: nativeObj };
      const result = normalizeToolArguments(schema as any, args as any);
      expect(result.metadata).toBe(nativeObj);
    });
  });

  describe("type guards", () => {
    it("skips type: string properties even if value looks like JSON", () => {
      const schema = {
        properties: {
          note: { type: "string" },
        },
      };
      const args = { note: '{"key":"value"}' };
      const result = normalizeToolArguments(schema as any, args as any);
      expect(result.note).toBe('{"key":"value"}');
    });

    it("skips type: number properties", () => {
      const schema = {
        properties: {
          count: { type: "number" },
        },
      };
      const args = { count: "42" };
      const result = normalizeToolArguments(schema as any, args as any);
      expect(result.count).toBe("42");
    });

    it("skips missing properties", () => {
      const schema = {
        properties: {
          items: { type: "array" },
        },
      };
      const args = { nothing: "here" };
      const result = normalizeToolArguments(schema as any, args as any);
      expect(result).toEqual({ nothing: "here" });
      expect(result.items).toBeUndefined();
    });
  });

  describe("validation after parse", () => {
    it("discards parsed result if not a valid array for type: array", () => {
      const schema = {
        properties: {
          items: { type: "array" },
        },
      };
      const args = { items: '"hello"' }; // valid JSON but is a string, not array
      const result = normalizeToolArguments(schema as any, args as any);
      expect(result.items).toBe('"hello"'); // original preserved
    });

    it("discards parsed result if null for type: array", () => {
      const schema = {
        properties: {
          items: { type: "array" },
        },
      };
      const args = { items: 'null' };
      const result = normalizeToolArguments(schema as any, args as any);
      expect(result.items).toBe('null'); // original preserved
    });
  });

  describe("edge cases", () => {
    it("accepts empty array string for type: array", () => {
      const schema = {
        properties: {
          items: { type: "array" },
        },
      };
      const args = { items: '[]' };
      const result = normalizeToolArguments(schema as any, args as any);
      expect(result.items).toEqual([]);
    });

    it("handles arrays with nested objects", () => {
      const schema = {
        properties: {
          things: { type: "array" },
        },
      };
      const args = {
        things: [{ id: 1, name: "first" }, { id: 2, name: "second" }],
      };
      const result = normalizeToolArguments(schema as any, args as any);
      expect(result.things).toStrictEqual([{ id: 1, name: "first" }, { id: 2, name: "second" }]);
    });

    it("handles objects with nested arrays", () => {
      const schema = {
        properties: {
          payload: { type: "object" },
        },
      };
      const args = { payload: "{ \"tags\": [\"a\", \"b\",\"c\"] }" };
      const result = normalizeToolArguments(schema as any, args as any);
      expect(result.payload).toEqual({ tags: ["a", "b", "c"] });
    });

    it("does not attempt to parse allOf/anyOf/oneOf properties", () => {
      const schema = {
        properties: {
          maybe: {
            type: "array",
            allOf: [{ type: "object" }, { type: "array" }],
          },
        },
      };
      const args = { maybe: "[1, 2, 3]" };
      const result = normalizeToolArguments(schema as any, args as any);
      // Should NOT parse because allOf is present
      expect(result.maybe).toBe("[1, 2, 3]");
    });

    it("handles empty rawArgs", () => {
      const schema = {
        properties: {
          items: { type: "array" },
        },
      };
      const result = normalizeToolArguments(schema as any, {});
      expect(result).toEqual({});
    });
  });
});
