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
| `decisions`      | `dec_…` id, request, verdict, reason, mandate, nonce, mode, issued_at, verdict_token, supersedes, idempotency_key       | authorizer   | **Append-only** (trigger rejects UPDATE/DELETE) |
| `reviews`        | id, decision, status, resolved_at                                                                                       | authorizer   | Expires after 24h                               |
| `payments`       | decision, tx_hash, amount, status                                                                                       | agent        | Links a decision to its settlement              |
| `settlements`    | tx_hash, log_index, from, to, value, block                                                                              | indexer only | Unique on (tx_hash, log_index)                  |
| `nonces`         | nonce (PK), exp, delivery_id                                                                                            | seller       | Insert-or-fail = atomic replay check            |
| `chain_cursor`   | last_block                                                                                                              | indexer      | Safe restarts                                   |
| idempotency keys | key, body hash, decision, created_at                                                                                    | authorizer   | Same key + body within 24h → original decision  |

## Rules enforced by the database itself

These live in migrations, not just in application code, so a bug in a service can't break them:

- **Append-only `decisions`:** a trigger raises an error on any UPDATE or DELETE.
- **Immutable mandates:** a trigger allows only `status` to change from `active` to `revoked`.
- **Replay protection:** `nonces.nonce` is the primary key; a duplicate insert fails.
- **Money as integers:** amount columns are `bigint` (or `numeric` with no fraction) in base units. No `real` or `double`.

## Commands

From the repo root:

```sh
pnpm db:up         # start local Postgres in Docker
pnpm db:generate   # create a migration from schema changes
pnpm db:migrate    # apply migrations
pnpm --filter @tollgate/db studio   # browse data in Drizzle Studio
```

Migrations are written to `packages/db/drizzle/`. Triggers are added as hand-written SQL migrations.

## Folder plan

```
src/
  index.ts     exports the client and tables
  schema.ts    Drizzle table definitions
  client.ts    creates the pg pool from DATABASE_URL
drizzle/       generated + hand-written SQL migrations
drizzle.config.ts
```

## Config

`DATABASE_URL` (defaults to the local Docker database).

## Built on

Day 1 (setup), Day 2 (authorizer tables + triggers), then extended by the seller (Day 4) and indexer (Day 6).
