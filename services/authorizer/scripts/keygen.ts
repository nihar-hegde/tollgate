// Adds the authorizer's signing key and API keys to the repo's .env, keeping any already there.
// Values are never printed.

import { randomBytes } from "node:crypto";
import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { generateSigningKey } from "../src/signing";

const ENV_FILE = fileURLToPath(new URL("../../../.env", import.meta.url));
const existing = existsSync(ENV_FILE) ? readFileSync(ENV_FILE, "utf8") : "";

const generated = {
  AUTHORIZER_SIGNING_KEY: `'${JSON.stringify(await generateSigningKey())}'`,
  AUTHORIZER_AGENT_KEY: `ak_local_${randomBytes(16).toString("hex")}`,
  AUTHORIZER_SECRET_KEY: `sk_local_${randomBytes(16).toString("hex")}`,
};

const missing = Object.entries(generated).filter(
  ([name]) => !new RegExp(`^${name}=.+`, "m").test(existing),
);

if (missing.length === 0) {
  console.log("All authorizer keys are already in .env; nothing changed.");
} else {
  const lines = missing.map(([name, value]) => `${name}=${value}`).join("\n");
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  appendFileSync(ENV_FILE, `${separator}\n# Authorizer keys (generated)\n${lines}\n`);
  console.log(`Added to .env: ${missing.map(([name]) => name).join(", ")}`);
}
