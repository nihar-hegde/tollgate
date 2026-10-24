// @ts-check
import js from "@eslint/js";
import nextVitals from "eslint-config-next/core-web-vitals";
import prettier from "eslint-config-prettier";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "**/.next/",
      "**/coverage/",
      "**/drizzle/",
      "tollgate-kit/",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      globals: globals.node,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  // Plain JS config files aren't in any tsconfig, so skip type-aware rules there.
  {
    files: ["**/*.{js,mjs,cjs}"],
    ...tseslint.configs.disableTypeChecked,
  },
  // Next.js rules apply only to the console.
  ...nextVitals.map((config) => ({
    ...config,
    files: ["apps/console/**/*.{ts,tsx,js,jsx}"],
  })),
  {
    files: ["apps/console/**/*.{ts,tsx,js,jsx}"],
    settings: { next: { rootDir: "apps/console" } },
  },
  prettier,
);
