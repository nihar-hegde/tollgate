import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "authorizer",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    globalSetup: ["test/global-setup.ts"],
    passWithNoTests: true,
  },
});
