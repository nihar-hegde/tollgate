import { resetTestDatabase, testDatabaseUrl } from "@tollgate/db/testing";

export async function setup(): Promise<void> {
  await resetTestDatabase(testDatabaseUrl("seller"));
}
