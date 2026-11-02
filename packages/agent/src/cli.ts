// pnpm --filter @tollgate/agent buy <url> [--max 0.05] [--category data]
// pnpm --filter @tollgate/agent resume <url> <review decision id>

import { parseArgs } from "node:util";
import { toBaseUnits } from "@tollgate/shared";
import { privateKeyToAccount } from "viem/accounts";
import { createBuyer, type Outcome } from "./buyer";
import { loadConfig } from "./config";

const EXPLORER = "https://sepolia.basescan.org/tx";

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    max: { type: "string", default: "0.05" },
    category: { type: "string", default: "data" },
  },
});
const [command, url, decision] = positionals;
const USAGE = "usage: buy <url> [--max 0.05] [--category data] | resume <url> <decision>";

function maxAmount(dollars: string): bigint {
  try {
    return toBaseUnits(dollars);
  } catch (error) {
    console.error(`--max: ${(error as Error).message}\n${USAGE}`);
    process.exit(2);
  }
}

const config = loadConfig(process.env);
const buyer = createBuyer({ ...config, signer: privateKeyToAccount(config.privateKey) });

let outcome: Outcome;
if (command === "buy" && url) {
  outcome = await buyer.payAndFetch({
    url,
    maxAmount: maxAmount(values.max),
    category: values.category,
  });
} else if (command === "resume" && url && decision) {
  outcome = await buyer.resume(url, decision);
} else {
  console.error(USAGE);
  process.exit(2);
}

console.log(JSON.stringify(outcome, null, 2));
if (outcome.status === "delivered" && outcome.txHash) console.log(`${EXPLORER}/${outcome.txHash}`);
process.exitCode = outcome.status === "delivered" ? 0 : 1;
