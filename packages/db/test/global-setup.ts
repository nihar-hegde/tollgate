import { resetTestDatabase, testDatabaseUrl } from "../src/testing";

export async function setup(): Promise<void> {
  await resetTestDatabase(testDatabaseUrl("db"));
}
