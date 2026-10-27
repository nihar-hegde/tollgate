import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;

// One per process. The URL is passed in so tests can point at tollgate_test
// while services pass process.env.DATABASE_URL.
export function createDb(url: string) {
  const pool = new Pool({ connectionString: url });
  return drizzle(pool, { schema });
}
