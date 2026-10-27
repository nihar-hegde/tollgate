# ADR 0003: The database enforces the audit rules itself

Status: accepted · 2026-10-27

## Context

Tollgate's audit story rests on a few promises: decisions are never changed after they are written, mandates are never edited (only revoked), an agent has at most one active mandate per currency, and a review is approved into at most one `allow`. If these lived only in the authorizer's code, one bug, a script, or someone in `psql` could break them silently, and the log would no longer prove anything.

## Decision

1. **Rules that look at one row are CHECK constraints**: verdict and status spellings (built from the lists in `@tollgate/shared`), positive amounts, `per_transaction ≤ per_month`, `mandate_id` present on every decision except `deny_no_mandate`, `supersedes_id` only on an `allow`, `revoked_at` set exactly when revoked.
2. **Rules across rows are unique indexes**: one active mandate per agent and currency (partial index on `status = 'active'`), unique verdict nonce, one `allow` per superseded review, one replacement per mandate.
3. **Rules about change are triggers** (hand-written in `drizzle/0001_triggers.sql`):
   - `decisions`: UPDATE, DELETE and TRUNCATE are rejected.
   - `mandates`: the only UPDATE allowed is `active → revoked` (with `revoked_at`); DELETE is rejected.
   - `reviews`: the only UPDATE allowed is `pending → approved | denied` (with `resolved_at`); DELETE is rejected.
     The mandate and review triggers compare the old and new rows as JSON, minus the columns allowed to change, so a column added later is protected without editing the trigger.
4. **Idempotency keys get their own table** rather than a column on `decisions`. The key is the primary key, so two concurrent retries can't both create a decision, and an expired key can be reused without touching the append-only log.
5. **A review's "expired" state is computed** (pending and past `expires_at`), not stored, so nothing has to run on a timer.
6. **`decisions.agent_id` is not a foreign key**, because requests naming an unknown agent are logged too (ADR 0002 rule 5).

All rejections use SQLSTATE `23001` (`restrict_violation`) so the services can tell them apart from other errors.

## Consequences

- The promises hold whatever connects to the database. A database superuser could still disable triggers; that is out of scope for a demo and noted in the README.
- Tests can't clean up with DELETE or TRUNCATE; they recreate a separate `tollgate_test` database instead.
- Fixing a wrong decision means writing a new one, as with any append-only ledger.
