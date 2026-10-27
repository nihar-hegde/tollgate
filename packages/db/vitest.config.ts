import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "db",
    include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    // Recreates the tollgate_db_test database and applies the migrations.
    globalSetup: ["test/global-setup.ts"],
    passWithNoTests: true,
  },
});
