// Runs once before the database tests: drops tollgate_test, creates it again
// and applies every migration, so each run starts from exactly what
// `pnpm db:migrate` would build. The rules forbid DELETE and TRUNCATE on the
// log, so recreating the database is also the only clean way to reset it.

import { fileURLToPath } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { databaseName, maintenanceUrl, TEST_DATABASE_URL } from "./test-database";

const MIGRATIONS = fileURLToPath(new URL("../drizzle", import.meta.url));

export async function setup(): Promise<void> {
  const name = databaseName(TEST_DATABASE_URL);
  if (!name.endsWith("_test")) {
    throw new Error(`refusing to reset database "${name}": test databases must end in _test`);
  }

  const server = new Client({ connectionString: maintenanceUrl(TEST_DATABASE_URL) });
  try {
    await server.connect();
  } catch (error) {
    throw new Error(
      "Postgres is not reachable for the database tests. Start it with `pnpm db:up`.",
      {
        cause: error,
      },
    );
  }
  try {
    // The name passed the check above, so quoting it is enough.
    await server.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    await server.query(`CREATE DATABASE "${name}"`);
  } finally {
    await server.end();
  }

  const client = new Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    await migrate(drizzle(client), { migrationsFolder: MIGRATIONS });
  } finally {
    await client.end();
  }
}
