import { createDb } from "@tollgate/db";
import { createApp } from "./app";
import { loadConfig } from "./config";
import { createSigner } from "./signing";

const config = loadConfig(process.env);
const db = createDb(config.databaseUrl);
const signer = await createSigner(config.signingKey);

const app = createApp(
  { db, signer, now: () => new Date(), mode: config.mode, policyVersion: config.policyVersion },
  config.apiKeys,
);

const server = app.listen(config.port, () => {
  console.log(`authorizer on ${config.url} · mode ${config.mode} · key ${signer.kid}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close(() => void db.$client.end());
  });
}
