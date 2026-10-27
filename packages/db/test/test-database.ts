// Where the database tests run. Never the development database: the setup
// drops and recreates it on every run, and refuses any name not ending _test.

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://tollgate:tollgate@localhost:5432/tollgate_test";

export function databaseName(url: string): string {
  return new URL(url).pathname.slice(1);
}

// The same server, connected to its built-in `postgres` database, which is
// where databases are created and dropped from.
export function maintenanceUrl(url: string): string {
  const maintenance = new URL(url);
  maintenance.pathname = "/postgres";
  return maintenance.toString();
}
