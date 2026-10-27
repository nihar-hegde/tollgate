# apps/console

The operator console: the web app where a finance team sets agents' spending limits, approves large purchases, and audits every payment from approval to on-chain transaction.

It is a small working version of the console Saifuro lists on its Q4 2026 roadmap (policy editor, review queues, enforcement history), and of what the founding engineer role would own.

## Who uses it

| User       | Does                                                                  |
| ---------- | --------------------------------------------------------------------- |
| Operator   | Creates agents and mandates, revokes them, approves or denies reviews |
| Auditor    | Opens any decision to see exactly what was approved and why           |
| Controller | Exports the decision log                                              |

There is **no login** (multi-user auth is out of scope). The public demo will need a guard (Day 9).

## Screens

| Screen            | What it shows                                                                                                                | Priority |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------- |
| **Decisions**     | Filterable log of every decision. A row expands to the request, mandate, reason, decoded verdict token and the Basescan link | Must     |
| **Payment trace** | One payment's path: authorized → verified → settled → confirmed, ending in the Basescan transaction                          | Must     |
| **Mandates**      | Create, revoke, replace. Full history per agent. Editing is disabled on purpose, with a note explaining why                  | Must     |
| **Review queue**  | Decisions with verdict `review` and no resolution; approve or deny                                                           | Must     |
| **Overview**      | Spend today and over 30 days per agent, verdict counts, the indexer's two exception lists                                    | Should   |
| **Export**        | Download the decision log as NDJSON (one JSON object per line)                                                               | Should   |
| **Settings**      | Observe / enforce switch, with a confirmation step                                                                           | Should   |
| Webhooks          | Delivery log with replay                                                                                                     | Stretch  |
| Escrow            | Status of a small escrow contract                                                                                            | Stretch  |

## Built so far (Day 7)

- **Decisions** (`/decisions`): the latest 200 decisions, filterable by verdict and agent (TanStack Table). Each row shows how far its payment got: `denied`, `awaiting review`, `approved`, `authorized`, `unused`, `verified`, `payment failed`, `settled`, `confirmed`. Expanding a row shows the request, the mandate, the reason, the decoded verdict token and the Basescan link.
- **Payment trace** (`/decisions/[id]`): authorized → verified → settled → confirmed, with times, the block and the Basescan transaction. The page also shows:
  - the request;
  - the mandate exactly as it was (mandates are never edited);
  - the review, approval and delivery links, including the payer and EIP-3009 nonce;
  - the signed token, with its **signature checked** against the authorizer's published keys.
- **Mandates** (`/mandates`): every agent with its full mandate history, newest first. You can create an agent, create a mandate, **replace** one (on `/mandates/[id]/replace`, prefilled; the old one is revoked and the new one points back to it) and **revoke** one (after a confirmation). There is no edit, on purpose, and the page says why.

Next (Day 8): review queue, overview with the indexer's exception lists, NDJSON export.

## Important behaviours

- **Mandates are never edited.** "Replace" = revoke the old one and create a new one with `replaces` pointing back. The UI makes this visible, so it's clear old decisions were made under the old rules.
- **Review queue is built from decisions,** because Saifuro's API has no endpoint to list reviews (`GET /v1/reviews` returns 404). Tollgate copies this on purpose.
- **Approving a review** calls the authorizer, which issues a new `allow` with `supersedes`. The console never writes decisions itself.
- **Amounts** come from the database as base units and are formatted with `packages/shared` helpers. No float maths.
- **Basescan links** point to Base Sepolia (`sepolia.basescan.org/tx/<hash>`).

## Where the data comes from

[ADR 0008](../../docs/adr/0008-console-data-flow.md).

- **Reads:** straight from Postgres in server components (`lib/queries.ts`): decisions joined to reviews, the seller's deliveries and the indexer's settlements.
- **Writes:** server actions (`app/mandates/actions.ts`) call the authorizer's API with the secret key, which never reaches the browser. All business rules stay in the authorizer.
- **To the browser:** only strings. Bigints and dates are formatted on the server (`lib/views.ts`).

## Stack

Next.js 16 App Router, React 19, Tailwind 4, TanStack Table v8. The shadcn/ui components (button, badge, card, table, input, label) are copied in as source, which is shadcn's model. The CLI wasn't used. They depend on `class-variance-authority`, `clsx` and `tailwind-merge`, pinned.

## Running it

```sh
pnpm --filter @tollgate/authorizer dev   # writes go through it
pnpm --filter @tollgate/console dev      # http://localhost:3000
```

`next.config.ts` loads the repo's root `.env`, which Next.js wouldn't otherwise read from here.

## Tests

| File                       | Covers                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `lib/trace.test.ts`        | every trace stage: confirmed, settled, verified, payment failed, authorized, unused, denied, and the review states |
| `lib/mandate-form.test.ts` | form → Saifuro's mandate shape; blank review → no review; the errors an operator sees                              |
| `test/queries.test.ts`     | the joins (decision → delivery → settlement, mandate, review, approval), filters, mandate history                  |
| `test/actions.test.ts`     | create agent and mandate, replace, revoke twice, the authorizer's refusals shown, an unreachable authorizer        |

The integration tests run the real authorizer against `tollgate_console_test`.

## Folder plan

```
app/
  layout.tsx, page.tsx      page.tsx redirects to /decisions until the Day 8 overview
  decisions/page.tsx        the log
  decisions/[id]/page.tsx   one decision + payment trace + signature check
  mandates/page.tsx         agents, history, create
  mandates/[id]/replace/    replace form
  mandates/actions.ts       server actions → authorizer
components/
  ui/                       shadcn/ui-style primitives
  decisions-table.tsx       TanStack Table with expandable rows (client)
  mandate-forms.tsx         mandate, agent and revoke forms (client)
  trace.tsx, badges.tsx, facts.tsx, nav.tsx
lib/
  queries.ts   trace.ts   views.ts   token.ts   authorizer.ts   mandate-form.ts   db.ts   format.ts
test/
  harness.ts   queries.test.ts   actions.test.ts
```

## Config

`DATABASE_URL`, `AUTHORIZER_URL` (default `http://localhost:4000`), `AUTHORIZER_SECRET_KEY` (from the authorizer's `keygen`; server-side only).

## Built on

Day 7 (decisions, trace, mandates), Day 8 (review queue, overview, export), Day 9 (deploy on Vercel with seed data).
