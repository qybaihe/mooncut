import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    include: ["src/bits/__tests__/**/*.test.ts"],
  },
});
