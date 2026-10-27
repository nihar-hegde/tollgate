// pnpm --filter @tollgate/indexer report: the reconciliation, as the console will show it.

import { createDb } from "@tollgate/db";
import { fromBaseUnits } from "@tollgate/shared";
import { loadConfig } from "./config";
import { reconcile } from "./reconcile";

const config = loadConfig(process.env);
const db = createDb(config.databaseUrl);
const { confirmed, unconfirmed, unexpected, mismatched } = await reconcile(
  db,
  config.seller,
  new Date(),
);

const tx = (hash: string) => `https://sepolia.basescan.org/tx/${hash}`;
console.log({
  confirmed: confirmed.map(({ delivery, settlement }) => ({
    decision: delivery.decisionId,
    amount: fromBaseUnits(settlement.value),
    block: settlement.blockNumber,
    tx: tx(settlement.txHash),
  })),
  unconfirmed: unconfirmed.map((d) => ({
    decision: d.decisionId,
    status: d.status,
    since: d.createdAt,
  })),
  unexpected: unexpected.map((s) => ({
    from: s.fromAddress,
    amount: fromBaseUnits(s.value),
    block: s.blockNumber,
    tx: tx(s.txHash),
  })),
  mismatched: mismatched.map(({ delivery, problem }) => ({
    decision: delivery.decisionId,
    problem,
  })),
});
await db.$client.end();
