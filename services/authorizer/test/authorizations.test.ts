import { VERDICT_ISSUER } from "@tollgate/shared";
import { createLocalJWKSet, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import { KEYS, later, SELLER, START, useAuthorizer } from "./harness";

const api = useAuthorizer();

const SECOND = 1000;
const DAY = 24 * 60 * 60 * SECOND;

describe("POST /v1/authorizations", () => {
  it("returns the decision with Saifuro's field names", async () => {
    const { agent, mandate } = await api.newAgent();
    const { status, body } = await api.authorize(agent);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      decision: expect.stringMatching(/^dec_/) as string,
      request: {
        agent,
        amount: "0.01",
        currency: "USD",
        recipient: SELLER,
        category: "data",
        protocol: "x402",
      },
      verdict: "allow",
      reason: "passed all checks",
      mandate,
      policy_version: "pol_test.1",
      nonce: expect.stringMatching(/^n_/) as string,
      mode: "enforce",
      issued_at: START.toISOString(),
      supersedes: null,
      review: null,
    });
  });

  it("signs the request, verdict, mandate and nonce, valid for 5 minutes", async () => {
    const { agent, mandate } = await api.newAgent();
    const { body } = await api.authorize(agent);

    const { payload, protectedHeader } = await jwtVerify(
      body.verdict_token,
      createLocalJWKSet(api.jwks()),
      { currentDate: START, issuer: VERDICT_ISSUER },
    );
    expect(protectedHeader.kid).toMatch(/^local-/);
    expect(payload).toEqual({
      iss: VERDICT_ISSUER,
      jti: body.decision,
      iat: START.getTime() / SECOND,
      exp: START.getTime() / SECOND + 300,
      verdict: "allow",
      mandate,
      policy_version: "pol_test.1",
      nonce: body.nonce,
      request: { agent, amount: "0.01", currency: "USD", recipient: SELLER, category: "data" },
    });
  });

  it("publishes the verification keys without an API key", async () => {
    const { status, body } = await api.call("GET", "/.well-known/jwks.json", { key: null });
    expect(status).toBe(200);
    expect(body).toEqual(api.jwks());
  });

  it("logs a request from an unknown agent as deny_no_mandate", async () => {
    const { body } = await api.authorize("agt_never_registered");
    expect(body).toMatchObject({ verdict: "deny_no_mandate", mandate: null });

    const logged = await api.call("GET", `/v1/decisions/${body.decision}`);
    expect(logged.status).toBe(200);
  });

  it("denies a disabled agent", async () => {
    const { agent } = await api.newAgent();
    await api.call("POST", `/v1/agents/${agent}/disable`);
    expect((await api.authorize(agent)).body.verdict).toBe("deny_no_mandate");
  });

  it("denies from the next request once the mandate is revoked", async () => {
    const { agent, mandate } = await api.newAgent();
    expect((await api.authorize(agent)).body.verdict).toBe("allow");

    await api.call("POST", `/v1/mandates/${mandate}/revoke`);
    expect((await api.authorize(agent)).body).toMatchObject({ verdict: "deny_revoked", mandate });
  });

  it("rejects an invalid request with 400 and logs nothing", async () => {
    const { agent } = await api.newAgent();
    const headers = { "Idempotency-Key": "same-key-for-both" };

    const invalid = await api.authorize(agent, { amount: 0.01 }, { headers });
    expect(invalid.status).toBe(400);
    expect(invalid.body).toMatchObject({ error: { code: "invalid_request" } });

    const valid = await api.authorize(agent, {}, { headers });
    expect(valid.headers.get("Idempotent-Replayed")).toBe("false");
  });

  it("requires an Idempotency-Key", async () => {
    const { agent } = await api.newAgent();
    const { status, body } = await api.authorize(agent, {}, { headers: { "Idempotency-Key": "" } });
    expect(status).toBe(400);
    expect(body).toMatchObject({ error: { code: "invalid_request" } });
  });

  it.each([
    ["no key", null],
    ["the secret key", KEYS.secret],
    ["a wrong key", `ak_local_${"0".repeat(32)}`],
  ])("refuses %s", async (_case, key) => {
    const { agent } = await api.newAgent();
    expect((await api.authorize(agent, {}, { key })).status).toBe(401);
  });
});

describe("rolling 30-day spend", () => {
  const smallMandate = { limits: { per_transaction: "1", per_month: "1", currency: "USD" } };

  it("counts allows toward per_month, but not denials or reviews", async () => {
    const { agent } = await api.newAgent({ ...smallMandate, review_above: "0.5" });

    expect((await api.authorize(agent, { amount: "1", category: "travel" })).body.verdict).toBe(
      "deny_category",
    );
    expect((await api.authorize(agent, { amount: "0.75" })).body.verdict).toBe("review");
    expect((await api.authorize(agent, { amount: "0.5" })).body.verdict).toBe("allow");
    expect((await api.authorize(agent, { amount: "0.5" })).body.verdict).toBe("allow");

    const over = await api.authorize(agent, { amount: "0.01" });
    expect(over.body).toMatchObject({
      verdict: "deny_limit",
      reason: "30-day spend 1.00 + 0.01 exceeds per_month limit 1.00",
    });
  });

  it("forgets allows once they are 30 days old", async () => {
    const { agent } = await api.newAgent({ ...smallMandate, review_above: undefined });
    await api.authorize(agent, { amount: "1" });

    api.clock.now = later(30 * DAY - SECOND);
    expect((await api.authorize(agent, { amount: "1" })).body.verdict).toBe("deny_limit");

    api.clock.now = later(30 * DAY);
    expect((await api.authorize(agent, { amount: "1" })).body.verdict).toBe("allow");
  });

  it("lets only as many concurrent requests through as the limit allows", async () => {
    const { agent } = await api.newAgent({
      limits: { per_transaction: "20", per_month: "50", currency: "USD" },
      review_above: undefined,
    });

    const results = await Promise.all(
      Array.from({ length: 5 }, () => api.authorize(agent, { amount: "20" })),
    );
    const verdicts = results.map((r) => r.body.verdict).sort();
    expect(verdicts).toEqual(["allow", "allow", "deny_limit", "deny_limit", "deny_limit"]);
  });
});

describe("velocity", () => {
  it("denies the 11th decision within 60 seconds, denials included", async () => {
    const { agent } = await api.newAgent();
    for (let i = 0; i < 5; i++) await api.authorize(agent, { category: "travel" });
    for (let i = 0; i < 5; i++) await api.authorize(agent);

    expect((await api.authorize(agent)).body.verdict).toBe("deny_velocity");
  });

  it("allows again once the earlier decisions are 60 seconds old", async () => {
    const { agent } = await api.newAgent();
    for (let i = 0; i < 10; i++) await api.authorize(agent);

    api.clock.now = later(59 * SECOND);
    expect((await api.authorize(agent)).body.verdict).toBe("deny_velocity");

    // The first 10 have left the window; only the denial at 59s still counts.
    api.clock.now = later(60 * SECOND);
    expect((await api.authorize(agent)).body.verdict).toBe("allow");
  });
});

describe("idempotency", () => {
  const headers = () => ({ "Idempotency-Key": `purchase-${Math.random()}` });

  it("returns the original decision for a retry with the same key and body", async () => {
    const { agent } = await api.newAgent();
    const options = { headers: headers() };

    const first = await api.authorize(agent, {}, options);
    const retry = await api.authorize(agent, {}, options);

    expect(retry.body).toEqual(first.body);
    expect(first.headers.get("Idempotent-Replayed")).toBe("false");
    expect(retry.headers.get("Idempotent-Replayed")).toBe("true");
  });

  it("treats the same values written differently as the same body", async () => {
    const { agent } = await api.newAgent();
    const options = { headers: headers() };

    const first = await api.authorize(agent, { amount: "0.01" }, options);
    const retry = await api.authorize(agent, { amount: "0.010" }, options);
    expect(retry.body.decision).toBe(first.body.decision);
  });

  it("rejects the same key with a different body", async () => {
    const { agent } = await api.newAgent();
    const options = { headers: headers() };

    await api.authorize(agent, { amount: "0.01" }, options);
    const reused = await api.authorize(agent, { amount: "0.02" }, options);
    expect(reused.status).toBe(422);
    expect(reused.body).toMatchObject({ error: { code: "idempotency_key_reused" } });
  });

  it("evaluates afresh once the key is 24 hours old", async () => {
    const { agent } = await api.newAgent();
    const options = { headers: headers() };
    const first = await api.authorize(agent, {}, options);

    api.clock.now = later(DAY);
    const fresh = await api.authorize(agent, {}, options);
    expect(fresh.body.decision).not.toBe(first.body.decision);
  });
});

describe("observe mode", () => {
  const observing = useAuthorizer({ mode: "observe" });

  it("stamps the mode on every decision", async () => {
    const { agent } = await observing.newAgent();
    expect((await observing.authorize(agent)).body.mode).toBe("observe");
  });
});
