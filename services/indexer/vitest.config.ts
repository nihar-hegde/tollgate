import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "indexer",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    passWithNoTests: true,
  },
});
