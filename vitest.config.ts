import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@": resolve(__dirname, "src/mainview"),
      "@shared": resolve(__dirname, "src/shared"),
    },
  },
  test: {
    include: ["src/mainview/**/*.test.ts"],
  },
});
