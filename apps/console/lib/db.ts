import { createDb, type Db } from "@tollgate/db";

// One pool per server process; dev reloads reuse it instead of opening new ones.
const cache = globalThis as unknown as { tollgateDb?: Db };

export function getDb(): Db {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  cache.tollgateDb ??= createDb(url);
  return cache.tollgateDb;
}
