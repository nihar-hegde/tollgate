import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = ReturnType<typeof createDb>;
export type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];

// The pool is `db.$client`; end it on shutdown.
export function createDb(url: string) {
  return drizzle(new Pool({ connectionString: url }), { schema });
}
