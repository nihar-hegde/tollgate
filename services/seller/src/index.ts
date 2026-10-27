import { createDb } from "@tollgate/db";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { createRemoteJWKSet } from "jose";
import { createApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig(process.env);
const db = createDb(config.databaseUrl);

const app = createApp({
  db,
  now: () => new Date(),
  payTo: config.payTo,
  asset: config.asset,
  facilitator: new HTTPFacilitatorClient({ url: config.facilitatorUrl }),
  policy: {
    // Saifuro's key set allows caching for five minutes.
    keys: createRemoteJWKSet(new URL(config.jwksUrl), { cacheMaxAge: 5 * 60 * 1000 }),
    issuer: config.issuer,
    audience: config.url,
    kidPrefixes: config.kidPrefixes,
    operatorMandates: config.operatorMandates,
  },
});

const server = app.listen(config.port, () => {
  console.log(
    `seller on ${config.url} · pays to ${config.payTo} · keys ${config.kidPrefixes.join(",")}`,
  );
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => void db.$client.end());
  });
}
