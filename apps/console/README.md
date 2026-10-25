# apps/console

The operator console: the web app where a finance team sets agents' spending limits, approves large purchases, and audits every payment from approval to on-chain transaction.

It is a small working version of the console Saifuro lists on its Q4 2026 roadmap (policy editor, review queues, enforcement history), and of what the founding engineer role would own.

## Who uses it

| User       | Does                                                                  |
| ---------- | --------------------------------------------------------------------- |
| Operator   | Creates agents and mandates, revokes them, approves or denies reviews |
| Auditor    | Opens any decision to see exactly what was approved and why           |
| Controller | Exports the decision log                                              |

There is **no login** (multi-user auth is out of scope). The public demo will be rate-limited.

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

## Important behaviours

- **Mandates are never edited.** "Replace" = revoke the old one and create a new one with `replaces` pointing back. The UI makes this visible, so it's clear old decisions were made under the old rules.
- **Review queue is built from decisions,** because Saifuro's API has no endpoint to list reviews (`GET /v1/reviews` returns 404). Tollgate copies this on purpose, and the README calls it out.
- **Approving a review** calls the authorizer, which issues a new `allow` with `supersedes`. The console never writes decisions itself.
- **Amounts** come from the database as base units and are formatted for display with `packages/shared` helpers. No float maths.
- **Basescan links** point to Base Sepolia (`sepolia.basescan.org/tx/<hash>`).

## Where the data comes from

- **Reads:** directly from Postgres (decisions, mandates, payments, settlements) using Next.js server components.
- **Writes:** through the authorizer's API (create or revoke mandate, approve or deny review, switch mode), so all business rules stay in one place.

## Stack

Next.js 16 App Router, React 19, Tailwind 4, shadcn/ui (added on Day 7), TanStack Table v8 for the decision log.

## Folder plan

```
app/
  layout.tsx, page.tsx      (Overview)
  decisions/                log + expandable rows
  decisions/[id]/           single decision + payment trace
  mandates/                 list, create, revoke, replace
  reviews/                  queue
  settings/                 observe / enforce
  api/export/route.ts       NDJSON download
components/                 shadcn/ui + tables
```

## Config

`DATABASE_URL`, `AUTHORIZER_URL`.

## Built on

Day 7 (decisions, trace, mandates), Day 8 (review queue, overview, export), Day 9 (deploy on Vercel with seed data).
