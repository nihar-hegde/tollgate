// Runs the real app on a random port against tollgate_authorizer_test.
// Each test makes its own agent, so tests never share spend, velocity or mandates.

import type { AddressInfo } from "node:net";
import { createDb } from "@tollgate/db";
import { testDatabaseUrl } from "@tollgate/db/testing";
import { newId, type Mode } from "@tollgate/shared";
import { afterAll, beforeAll, beforeEach } from "vitest";
import { createApp } from "../src/app";
import type { DecisionView } from "../src/mapping";
import { createSigner, generateSigningKey, type Signer } from "../src/signing";

export const KEYS = {
  agent: `ak_local_${"a".repeat(32)}`,
  secret: `sk_local_${"b".repeat(32)}`,
};

export const START = new Date("2026-10-27T12:00:00.000Z");
export const SELLER = "0xC625dAc9148Fa7eE8255a56Bcb07Dc4AC56ffcF0";

type Call = {
  key?: string | null;
  body?: unknown;
  headers?: Record<string, string>;
};

export type Response<T> = { status: number; headers: Headers; body: T };

export function useAuthorizer({ mode = "enforce" }: { mode?: Mode } = {}) {
  const clock = { now: START };
  let baseUrl = "";
  let signer: Signer;
  let close = () => Promise.resolve();

  beforeAll(async () => {
    const db = createDb(testDatabaseUrl("authorizer"));
    signer = await createSigner(await generateSigningKey());
    const app = createApp(
      { db, signer, now: () => clock.now, mode, policyVersion: "pol_test.1" },
      KEYS,
    );
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
    clock.now = START;
  });

  async function call<T = unknown>(method: string, path: string, options: Call = {}) {
    const { key = KEYS.secret, body, headers = {} } = options;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        ...(key !== null && { Authorization: `Bearer ${key}` }),
        ...(body !== undefined && { "Content-Type": "application/json" }),
        ...headers,
      },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
    return {
      status: response.status,
      headers: response.headers,
      body: (await response.json()) as T,
    } satisfies Response<T>;
  }

  // A new agent with the user-story mandate: $5 per call, $50 per 30 days, data, review above $2.
  async function newAgent(mandate: Record<string, unknown> = {}) {
    const agent = `agt_${newId("nonce").slice(2, 18)}`;
    await call("POST", "/v1/agents", { body: { id: agent, name: "Test agent" } });
    const created = await call<{ mandate: string }>("POST", "/v1/mandates", {
      body: {
        agent,
        principal: "role:research_lead",
        limits: { per_transaction: "5", per_month: "50", currency: "USD" },
        categories: ["data"],
        review_above: "2",
        expires: "2026-12-31",
        ...mandate,
      },
    });
    if (created.status !== 201)
      throw new Error(`test setup failed: ${JSON.stringify(created.body)}`);
    return { agent, mandate: created.body.mandate };
  }

  function authorize(agent: string, request: Record<string, unknown> = {}, options: Call = {}) {
    return call<DecisionView>("POST", "/v1/authorizations", {
      key: KEYS.agent,
      headers: { "Idempotency-Key": newId("nonce") },
      ...options,
      body: {
        agent,
        amount: "0.01",
        currency: "USD",
        recipient: SELLER,
        category: "data",
        protocol: "x402",
        ...request,
      },
    });
  }

  return {
    clock,
    call,
    newAgent,
    authorize,
    jwks: () => signer.jwks,
  };
}

export function later(ms: number): Date {
  return new Date(START.getTime() + ms);
}
