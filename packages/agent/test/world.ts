// The whole loop without a chain: the real authorizer and the real seller on
// random ports against tollgate_agent_test, and a fake facilitator that checks
// the buyer's EIP-3009 signature the way the USDC contract would.

import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createApp as createAuthorizer } from "@tollgate/authorizer/app";
import { createSigner, generateSigningKey } from "@tollgate/authorizer/signing";
import { createDb, deliveries, type Db } from "@tollgate/db";
import { testDatabaseUrl } from "@tollgate/db/testing";
import { createApp as createSeller } from "@tollgate/seller/app";
import { VERDICT_ISSUER } from "@tollgate/shared";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentPayload, PaymentRequirements, VerifyResponse } from "@x402/core/types";
import { eq } from "drizzle-orm";
import { createLocalJWKSet } from "jose";
import { getAddress, verifyTypedData, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { createBuyer, NETWORK } from "../src/buyer";

export const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const SELLER = "0xC625dAc9148Fa7eE8255a56Bcb07Dc4AC56ffcF0";
const KEYS = { agent: `ak_local_${"a".repeat(32)}`, secret: `sk_local_${"b".repeat(32)}` };

type Authorization = {
  from: Hex;
  to: Hex;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: Hex;
};

// What the USDC contract checks on transferWithAuthorization, minus the balance.
async function signedCorrectly(payload: PaymentPayload, requirements: PaymentRequirements) {
  const { signature, authorization } = payload.payload as {
    signature: Hex;
    authorization: Authorization;
  };
  const valid = await verifyTypedData({
    address: authorization.from,
    domain: {
      name: "USDC",
      version: "2",
      chainId: 84532,
      verifyingContract: getAddress(requirements.asset),
    },
    types: {
      TransferWithAuthorization: [
        { name: "from", type: "address" },
        { name: "to", type: "address" },
        { name: "value", type: "uint256" },
        { name: "validAfter", type: "uint256" },
        { name: "validBefore", type: "uint256" },
        { name: "nonce", type: "bytes32" },
      ],
    },
    primaryType: "TransferWithAuthorization",
    message: {
      ...authorization,
      value: BigInt(authorization.value),
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
    },
    signature,
  });
  return (
    valid &&
    getAddress(authorization.to) === getAddress(requirements.payTo) &&
    authorization.value === requirements.amount
  );
}

function fakeFacilitator() {
  const fake = { calls: [] as string[], reject: null as string | null };
  const client: FacilitatorClient = {
    verify: async (payload, requirements): Promise<VerifyResponse> => {
      fake.calls.push("verify");
      if (fake.reject) return { isValid: false, invalidReason: fake.reject };
      return (await signedCorrectly(payload, requirements))
        ? { isValid: true }
        : { isValid: false, invalidReason: "invalid_signature" };
    },
    settle: () => {
      fake.calls.push("settle");
      const transaction = `0x${randomBytes(32).toString("hex")}`;
      return Promise.resolve({ success: true, transaction, network: NETWORK });
    },
    getSupported: () =>
      Promise.resolve({
        kinds: [{ x402Version: 2, scheme: "exact", network: NETWORK }],
        extensions: [],
        signers: {},
      }),
  };
  return { fake, client };
}

async function listen(app: ReturnType<typeof createSeller>) {
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const url = `http://localhost:${(server.address() as AddressInfo).port}`;
  return { url, close: () => new Promise((resolve) => server.close(resolve)) };
}

export function useWorld() {
  const { fake: facilitator, client } = fakeFacilitator();
  const wallet = privateKeyToAccount(generatePrivateKey());
  const operatorMandates = new Set<string>();
  const world = { authorizerUrl: "", sellerUrl: "", facilitator, wallet };
  let db: Db;
  const servers: { close: () => Promise<unknown> }[] = [];

  beforeAll(async () => {
    db = createDb(testDatabaseUrl("agent"));
    const signer = await createSigner(await generateSigningKey());
    const now = () => new Date();

    const authorizer = await listen(
      createAuthorizer({ db, now, signer, mode: "enforce", policyVersion: "pol_test.1" }, KEYS),
    );
    const seller = await listen(
      createSeller({
        db,
        now,
        payTo: SELLER,
        asset: USDC,
        facilitator: client,
        policy: {
          keys: createLocalJWKSet(signer.jwks),
          issuer: VERDICT_ISSUER,
          audience: "http://localhost:4001",
          kidPrefixes: ["local-"],
          operatorMandates,
        },
      }),
    );
    servers.push(authorizer, seller);
    world.authorizerUrl = authorizer.url;
    world.sellerUrl = seller.url;
  });
  afterAll(async () => {
    await Promise.all(servers.map((s) => s.close()));
    await db.$client.end();
  });
  beforeEach(() => {
    facilitator.calls = [];
    facilitator.reject = null;
  });

  // The operator's side: a fresh agent with the user-story mandate, registered with the seller.
  async function newAgent(mandate: Record<string, unknown> = {}) {
    const agent = `agt_${randomBytes(6).toString("hex")}`;
    await admin("POST", "/v1/agents", { id: agent, name: "Test agent" });
    const { mandate: id } = (await admin("POST", "/v1/mandates", {
      agent,
      principal: "role:research_lead",
      limits: { per_transaction: "5", per_month: "50", currency: "USD" },
      categories: ["data"],
      review_above: "2",
      expires: "2026-12-31",
      ...mandate,
    })) as { mandate: string };
    operatorMandates.add(id);
    return { agent, mandate: id };
  }

  async function admin(method: string, path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${world.authorizerUrl}${path}`, {
      method,
      headers: { Authorization: `Bearer ${KEYS.secret}`, "Content-Type": "application/json" },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    if (!response.ok)
      throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
    return response.json();
  }

  function buyerFor(
    agent: string,
    overrides: { authorizerUrl?: string; agentKey?: string; asset?: string } = {},
  ) {
    return createBuyer({
      authorizerUrl: world.authorizerUrl,
      agentKey: KEYS.agent,
      agent,
      asset: USDC,
      signer: wallet,
      ...overrides,
    });
  }

  function deliveryOf(decision: string) {
    return db.select().from(deliveries).where(eq(deliveries.decisionId, decision));
  }

  return Object.assign(world, { newAgent, admin, buyerFor, deliveryOf, operatorMandates });
}
