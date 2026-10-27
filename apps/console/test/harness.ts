// The real authorizer on a random port against tollgate_console_test, with the
// console's server code pointed at it the way .env points it at :4000.

import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp } from "@tollgate/authorizer/app";
import { createSigner, generateSigningKey } from "@tollgate/authorizer/signing";
import { createDb, deliveries, settlements, type Db } from "@tollgate/db";
import { testDatabaseUrl } from "@tollgate/db/testing";
import { newId } from "@tollgate/shared";
import { afterAll, beforeAll } from "vitest";

const KEYS = { agent: `ak_local_${"a".repeat(32)}`, secret: `sk_local_${"b".repeat(32)}` };
export const SELLER = "0xC625dAc9148Fa7eE8255a56Bcb07Dc4AC56ffcF0";

export function startAuthorizer() {
  const world = { db: undefined as unknown as Db };
  let close = () => Promise.resolve();

  beforeAll(async () => {
    world.db = createDb(testDatabaseUrl("console"));
    const signer = await createSigner(await generateSigningKey());
    const app = createApp(
      { db: world.db, signer, now: () => new Date(), mode: "enforce", policyVersion: "pol_test.1" },
      KEYS,
    );
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    process.env.AUTHORIZER_URL = `http://localhost:${(server.address() as AddressInfo).port}`;
    process.env.AUTHORIZER_SECRET_KEY = KEYS.secret;
    close = async () => {
      await new Promise((resolve) => server.close(resolve));
      await world.db.$client.end();
    };
  });
  afterAll(() => close());

  async function call<T>(method: string, path: string, key: string, body?: unknown): Promise<T> {
    const response = await fetch(`${process.env.AUTHORIZER_URL}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        "Idempotency-Key": newId("nonce"),
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (!response.ok) throw new Error(`${method} ${path}: ${await response.text()}`);
    return (await response.json()) as T;
  }

  async function newAgent() {
    const agent = `agt_${randomBytes(6).toString("hex")}`;
    await call("POST", "/v1/agents", KEYS.secret, { id: agent, name: "Test agent" });
    const { mandate } = await call<{ mandate: string }>("POST", "/v1/mandates", KEYS.secret, {
      agent,
      principal: "role:research_lead",
      limits: { per_transaction: "5", per_month: "50", currency: "USD" },
      categories: ["data"],
      review_above: "2",
      expires: "2026-12-31",
    });
    return { agent, mandate };
  }

  function authorize(agent: string, request: Record<string, string> = {}) {
    return call<{ decision: string; verdict: string; nonce: string }>(
      "POST",
      "/v1/authorizations",
      KEYS.agent,
      {
        agent,
        amount: "0.01",
        currency: "USD",
        recipient: SELLER,
        category: "data",
        ...request,
      },
    );
  }

  // What the seller and the indexer write after a paid call.
  async function paidAndIndexed(decision: { decision: string; nonce: string }, agent: string) {
    const txHash = `0x${randomBytes(32).toString("hex")}`;
    await world.db.insert(deliveries).values({
      id: newId("delivery"),
      decisionId: decision.decision,
      verdictNonce: decision.nonce,
      mandateId: "mnd_test",
      agentId: agent,
      amount: 10_000n,
      recipient: SELLER,
      resource: "GET /v1/insight",
      verdictToken: "header.payload.signature",
      status: "settled",
      txHash,
      completedAt: new Date(),
    });
    await world.db.insert(settlements).values({
      txHash,
      logIndex: 2,
      blockNumber: 50_980_908n,
      fromAddress: "0xaC907cE6C87aFE02E9995dAe8cAe194cffee3550",
      toAddress: SELLER,
      value: 10_000n,
    });
    return txHash;
  }

  return { world, call, keys: KEYS, newAgent, authorize, paidAndIndexed };
}
