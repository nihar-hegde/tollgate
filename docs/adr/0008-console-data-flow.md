# ADR 0008: Console data flow

Status: accepted · 2026-10-27

## Context

The console shows what three services wrote (decisions, deliveries, settlements) and lets an operator change mandates. Saifuro's own console is on their Q4 roadmap, and their API can't list reviews. The rules about who may change what already live in the authorizer and in database triggers.

## Decision

1. **Reads go straight to Postgres** from server components (`lib/queries.ts`, via `@tollgate/db`). A decision is joined to its review, the seller's delivery and the indexer's settlement in one query, so the log shows how far each payment got.
2. **Writes go through the authorizer's API** as server actions, with the secret key read on the server only. The console never writes a mandate or decision row itself, so every rule (one active mandate, revoke-only, replace in one step) stays in one place.
3. **The payment trace is a pure function** (`lib/trace.ts`): authorized → verified → settled → confirmed, plus one stage label per case (denied, awaiting review, approved, unused, payment failed, …). A review decision is never paid itself; an approval pays under the new `allow`.
4. **The auditor sees a checked signature.** The decision page verifies the verdict token against the authorizer's published key set, with the clock set to the token's `iat`, since every token has expired by the time anyone audits it.
5. **shadcn/ui's pattern without its CLI.** The few components needed (button, badge, card, table, input, label) are copied in as source with `class-variance-authority`, `clsx` and `tailwind-merge`, pinned. No Radix and no icon library: a native `<select>`, `<details>` and `confirm()` cover Day 7.
6. **Reviews, overview and export read the same way.** The review queue is built from decisions joined to reviews, as Saifuro's API can't list them. The overview imports the indexer's `reconcile()` rather than calling a service. Export streams NDJSON oldest first in offset batches, all inside one read-only `repeatable read` transaction. The authorizer can commit a decision after later-stamped ones, so without a snapshot a decision arriving mid-export would shift the offsets and repeat a row.
7. **Only strings cross to the browser.** Bigints and dates are formatted on the server (`lib/views.ts`) before reaching the TanStack Table client component.

## Consequences

- The console needs `DATABASE_URL` (read access) and the authorizer's secret key; `next.config.ts` loads the repo's root `.env`.
- No login: multi-user auth is out of scope, and the deployed demo needs another guard (Day 9).
- The decision log shows the latest 200, filtered by verdict and agent; paging can come later.
