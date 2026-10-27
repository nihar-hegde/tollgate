// Test-only helpers. Each package tests against its own database, so parallel runs never collide.

import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";

const TEST_SERVER = process.env.TEST_POSTGRES_URL ?? "postgres://tollgate:tollgate@localhost:5432";
const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

export function testDatabaseUrl(pkg: string): string {
  const url = new URL(TEST_SERVER);
  url.pathname = `/tollgate_${pkg}_test`;
  return url.toString();
}

// Drops, recreates and migrates the database. Refuses any name not ending in _test.
export async function resetTestDatabase(url: string): Promise<void> {
  const name = new URL(url).pathname.slice(1);
  if (!/^[a-z0-9_]+_test$/.test(name)) {
    throw new Error(`refusing to reset "${name}": test database names must end in _test`);
  }

  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  const server = new Client({ connectionString: maintenance.toString() });
  try {
    await server.connect();
  } catch (error) {
    throw new Error("Postgres is not reachable for the tests. Start it with `pnpm db:up`.", {
      cause: error,
    });
  }
  try {
    await server.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await server.query(`CREATE DATABASE "${name}"`);
  } finally {
    await server.end();
  }

  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  } finally {
    await client.end();
  }
}
