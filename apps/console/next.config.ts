import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// The repo keeps one .env at its root; Next.js only looks in this folder.
const rootEnv = fileURLToPath(new URL("../../.env", import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  // Workspace packages ship TypeScript source.
  transpilePackages: ["@tollgate/shared", "@tollgate/db", "@tollgate/indexer"],
  serverExternalPackages: ["pg"],
};

export default nextConfig;
