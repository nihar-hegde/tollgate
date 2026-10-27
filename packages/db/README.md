# packages/db

The database layer: the Postgres schema, migrations and a shared client, all with Drizzle ORM. Every service uses this one package so there is a single definition of every table.

> Not in the original spec's layout. Added because three services share one database; putting the schema in any one service would make the others depend on it.

## One database

Tollgate uses **one Postgres database**. Each service connects to it but writes only its own tables. Copies of it exist per environment: Docker locally (`docker-compose.yml`), Neon when deployed, and a separate one for tests.

## Tables

| Table            | Key columns                                                                                                             | Written by   | Rule                                            |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------ | ----------------------------------------------- |
| `agents`         | `agt_…` id, name, status                                                                                                | authorizer   | Disabled agent → `deny_no_mandate`              |
| `mandates`       | `mnd_…` id, agent, principal, per_transaction, per_month, currency, categories, review_above, expires, status, replaces | authorizer   | Only `status` may change, and only to `revoked` |
| `decisions`      | `dec_…` id, request, verdict, reason, mandate, nonce, mode, issued_at, verdict_token, supersedes, policy_version        | authorizer   | **Append-only** (trigger rejects UPDATE/DELETE) |
| `reviews`        | id, decision, status, expires_at, resolved_at                                                                           | authorizer   | Expires after 24h                               |
| `payments`       | decision, tx_hash, amount, status                                                                                       | agent        | Links a decision to its settlement              |
| `settlements`    | tx_hash, log_index, from, to, value, block                                                                              | indexer only | Unique on (tx_hash, log_index)                  |
| `nonces`         | nonce (PK), exp, delivery_id                                                                                            | seller       | Insert-or-fail = atomic replay check            |
| `chain_cursor`   | last_block                                                                                                              | indexer      | Safe restarts                                   |
| idempotency keys | key, body hash, decision, created_at                                                                                    | authorizer   | Same key + body within 24h → original decision  |

Built so far (Day 2): `agents`, `mandates`, `decisions`, `reviews`, `idempotency_keys`. The seller's and indexer's tables (`payments`, `settlements`, `nonces`, `chain_cursor`) come on Days 4–6.

## Rules enforced by the database itself

These live in migrations, not just in application code, so a bug in a service can't break them. Why and how: [ADR 0003](../../docs/adr/0003-database-rules.md).

- **Append-only `decisions`:** a trigger rejects UPDATE, DELETE and TRUNCATE.
- **Revoke-only mandates:** a trigger allows one change, `active → revoked` with `revoked_at`; DELETE is rejected.
- **Reviews resolve once:** `pending → approved | denied` with `resolved_at`; nothing else.
- **One active mandate per agent and currency:** a partial unique index.
- **One `allow` per approved review:** `decisions.supersedes_id` is unique.
- **Spellings and shapes:** CHECK constraints for every verdict, status and mode (built from `@tollgate/shared`), positive amounts, `per_transaction ≤ per_month`, and a mandate on every decision except `deny_no_mandate`.
- **Replay protection:** `decisions.nonce` is unique here; the seller's `nonces` table (Day 4) is its own insert-or-fail check.
- **Money as integers:** amount columns are `bigint` in base units, read in TypeScript as `bigint`. No `real`, `double` or `numeric`.

Triggers reject with SQLSTATE `23001` (`restrict_violation`).

## Commands

From the repo root:

```sh
pnpm db:up         # start local Postgres in Docker
pnpm db:generate   # create a migration from schema changes
pnpm db:migrate    # apply migrations
pnpm --filter @tollgate/db studio   # browse data in Drizzle Studio
```

Migrations are written to `packages/db/drizzle/`. Triggers are added as hand-written SQL migrations.

## Tests

`test/rules.test.ts` proves every rule above against a real Postgres: for each one it attempts what the rule forbids and checks Postgres refused it for that reason (the constraint name, or SQLSTATE `23001` for triggers), and it checks the allowed changes still work.

- Needs Postgres running (`pnpm db:up`); `pnpm test` runs them with everything else.
- Each package tests against its own database (`tollgate_db_test`, `tollgate_authorizer_test`, …) so parallel test runs never collide. `resetTestDatabase()` from `@tollgate/db/testing` drops, recreates and migrates it before each run, and refuses any name not ending in `_test`, so it can never wipe the development database.
- Each test runs inside a transaction that is rolled back, so tests can't affect each other (and nothing has to DELETE from the append-only tables).
- CI runs the same tests against a Postgres service container.

## Folder plan

```
src/
  index.ts     exports the client, tables and one()
  schema.ts    Drizzle table definitions, CHECKs and indexes
  client.ts    createDb(url): a Drizzle client over a pg pool (db.$client); Transaction type
  rows.ts      one(rows): exactly one row or throw
  testing.ts   testDatabaseUrl(pkg), resetTestDatabase(url)  (import from @tollgate/db/testing)
drizzle/
  0000_authorizer_tables.sql   generated from schema.ts
  0001_triggers.sql            hand-written triggers
  meta/                        drizzle-kit's bookkeeping
test/
  rules.test.ts      every database rule, attempted and refused
  helpers.ts         rolled-back transactions, rejectionOf(), valid rows
  global-setup.ts    rebuilds tollgate_db_test before each run
drizzle.config.ts
```

Columns are snake_case with `id` keys (`mandate_id`); the API maps them to Saifuro's field names (`mandate`). After changing `schema.ts`, run `pnpm db:generate`; for anything Drizzle can't express, add a custom migration with `pnpm --filter @tollgate/db exec drizzle-kit generate --custom --name=<name>`.

## Config

`DATABASE_URL` (defaults to the local Docker database). `TEST_POSTGRES_URL` is the server the test databases live on (defaults to the local Docker server).

## Built on

Day 1 (setup), Day 2 (authorizer tables + triggers), then extended by the seller (Day 4) and indexer (Day 6).
