# Tollgate

A pay-per-call API that only serves AI agents whose spending was approved, plus a console showing who approved what and where the money went on-chain.

An open-source reference integration built against Saifuro's public docs. Not affiliated with Saifuro. **Testnet only** (Base Sepolia); no real funds.

> Work in progress. Full README (architecture, demo, trade-offs) comes at the end of the build.

## Layout

```
apps/console          Next.js operator console
services/authorizer   decisions, mandates, reviews, JWKS (local stand-in)
services/seller       x402 paywall + verdict verifier
services/indexer      USDC Transfer watcher + reconciliation
packages/agent        MCP server + CLI buyer
packages/shared       types, Zod schemas, amount helpers
packages/db           Drizzle schema, migrations, Postgres client
```

## Run locally

Requires Node 24, pnpm 11 and Docker.

```sh
cp .env.example .env    # testnet keys only
pnpm install
pnpm db:up              # Postgres on localhost:5432
pnpm dev
```

## Checks

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm secrets:scan
```
