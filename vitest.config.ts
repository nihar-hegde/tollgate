import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["services/*", "packages/*"],
    passWithNoTests: true,
  },
});
