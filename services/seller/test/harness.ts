// Runs the real seller on a random port against tollgate_seller_test, with a
// fake facilitator so tests can see exactly when a payment is verified or
// settled, and make either fail.

import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { createDb, deliveries, type Db } from "@tollgate/db";
import { testDatabaseUrl } from "@tollgate/db/testing";
import { VERDICT_HEADER, VERDICT_ISSUER } from "@tollgate/shared";
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader,
} from "@x402/core/http";
import type { FacilitatorClient } from "@x402/core/server";
import type { PaymentRequired, SettleResponse, VerifyResponse } from "@x402/core/types";
import { eq } from "drizzle-orm";
import { createLocalJWKSet, decodeJwt } from "jose";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { createApp } from "../src/app";
import { NETWORK } from "../src/payment";
import { createIssuer, MANDATE, NOW, SELLER } from "./issuer";

export const USDC = "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
export const BUYER = "0xaC907cE6C87aFE02E9995dAe8cAe194cffee3550";

function fakeFacilitator() {
  const fake = {
    calls: [] as ("verify" | "settle")[],
    verify: { isValid: true, payer: BUYER } as VerifyResponse,
    settle: null as Partial<SettleResponse> | null,
    reset() {
      fake.calls = [];
      fake.verify = { isValid: true, payer: BUYER };
      fake.settle = null;
    },
  };
  const client: FacilitatorClient = {
    verify: () => {
      fake.calls.push("verify");
      return Promise.resolve(fake.verify);
    },
    settle: () => {
      fake.calls.push("settle");
      const transaction = `0x${randomBytes(32).toString("hex")}`;
      return Promise.resolve({
        success: true,
        transaction,
        network: NETWORK,
        payer: BUYER,
        ...fake.settle,
      });
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

type Body = {
  error?: { code: string; check?: string; message: string };
  resource?: string;
  delivery?: string;
  decision?: string;
  data?: string;
};

export function useSeller() {
  const clock = { now: NOW };
  const { fake: facilitator, client } = fakeFacilitator();
  let issuer: Awaited<ReturnType<typeof createIssuer>>;
  let sandbox: typeof issuer;
  let db: Db;
  let baseUrl = "";
  let close = () => Promise.resolve();

  beforeAll(async () => {
    issuer = await createIssuer();
    sandbox = await createIssuer("sandbox-test");
    db = createDb(testDatabaseUrl("seller"));
    const app = createApp({
      db,
      now: () => clock.now,
      payTo: SELLER,
      asset: USDC,
      facilitator: client,
      policy: {
        // Lists a sandbox key too, so the environment check is what refuses it.
        keys: createLocalJWKSet({ keys: [...issuer.jwks.keys, ...sandbox.jwks.keys] }),
        issuer: VERDICT_ISSUER,
        audience: "http://localhost:4001",
        kidPrefixes: ["local-"],
        operatorMandates: new Set([MANDATE]),
      },
    });
    const server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));
    baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
    close = async () => {
      await new Promise((resolve) => server.close(resolve));
      await db.$client.end();
    };
  });
  afterAll(() => close());
  beforeEach(() => {
    clock.now = NOW;
    facilitator.reset();
  });

  async function get(path: string, headers: Record<string, string> = {}) {
    const response = await fetch(`${baseUrl}${path}`, { headers });
    return {
      status: response.status,
      headers: response.headers,
      body: (await response.json()) as Body,
    };
  }

  // The free first call: what the 402 says this route costs.
  async function priceOf(path: string): Promise<PaymentRequired> {
    const { headers } = await get(path);
    return decodePaymentRequiredHeader(headers.get("PAYMENT-REQUIRED") ?? "");
  }

  // A payment the fake facilitator accepts, for exactly what the 402 asked.
  async function paymentFor(path: string): Promise<string> {
    const [accepted] = (await priceOf(path)).accepts;
    if (!accepted) throw new Error(`the 402 for ${path} lists no way to pay`);
    return encodePaymentSignatureHeader({
      x402Version: 2,
      accepted,
      payload: {
        signature: "0xsigned-offline-by-the-buyer",
        authorization: {
          from: BUYER,
          to: accepted.payTo,
          value: accepted.amount,
          nonce: eip3009Nonce(),
        },
      },
    });
  }

  async function buy(path: string, verdict: string | null) {
    const headers: Record<string, string> = { "PAYMENT-SIGNATURE": await paymentFor(path) };
    if (verdict !== null) headers[VERDICT_HEADER] = verdict;
    facilitator.calls = [];
    return get(path, headers);
  }

  // The outcome is written just after x402 answers, so tests poll for it.
  async function deliveryOf(token: string) {
    const decision = decodeJwt(token).jti ?? "";
    return db.select().from(deliveries).where(eq(deliveries.decisionId, decision));
  }

  return {
    clock,
    facilitator,
    get,
    priceOf,
    buy,
    deliveryOf,
    sign: (...args: Parameters<typeof issuer.sign>) => issuer.sign(...args),
    signAsSandbox: (...args: Parameters<typeof issuer.sign>) => sandbox.sign(...args),
  };
}

function eip3009Nonce(): string {
  return `0x${randomBytes(32).toString("hex")}`;
}

export function settlementIn(headers: Headers): SettleResponse {
  return decodePaymentResponseHeader(headers.get("PAYMENT-RESPONSE") ?? "");
}
