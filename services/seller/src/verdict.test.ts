import { toBaseUnits, VERDICT_ISSUER } from "@tollgate/shared";
import { createLocalJWKSet, SignJWT } from "jose";
import { beforeAll, describe, expect, it } from "vitest";
import { createIssuer, later, MANDATE, NOW, SELLER } from "../test/issuer";
import { checkVerdict, type Sale, type VerdictPolicy } from "./verdict";

const SALE: Sale = { amount: toBaseUnits("0.01"), currency: "USD", recipient: SELLER };

let issuer: Awaited<ReturnType<typeof createIssuer>>;
let policy: VerdictPolicy;

beforeAll(async () => {
  issuer = await createIssuer();
  policy = {
    keys: createLocalJWKSet(issuer.jwks),
    issuer: VERDICT_ISSUER,
    audience: "http://localhost:4001",
    kidPrefixes: ["local-"],
    operatorMandates: new Set([MANDATE]),
  };
});

async function check(token: string | undefined, options: { sale?: Sale; now?: Date } = {}) {
  return checkVerdict(token, options.sale ?? SALE, policy, options.now ?? NOW);
}

async function rejection(token: string | undefined, options?: { sale?: Sale; now?: Date }) {
  const result = await check(token, options);
  if (result.ok) throw new Error("expected the verdict to be rejected");
  return { check: result.check, reason: result.reason };
}

describe("an approval for this sale", () => {
  it("is accepted, with what the delivery record needs", async () => {
    const token = await issuer.sign({ jti: "dec_1", nonce: "n_1" });
    expect(await check(token)).toEqual({
      ok: true,
      approval: {
        decision: "dec_1",
        nonce: "n_1",
        mandate: MANDATE,
        agent: "agt_research_01",
        supersedes: null,
        amount: 10000n,
      },
    });
  });

  it("carries supersedes from an approved review", async () => {
    const result = await check(await issuer.sign({ supersedes: "dec_review" }));
    expect(result.ok && result.approval.supersedes).toBe("dec_review");
  });

  it("compares amounts as decimals, so 0.010 is the same price", async () => {
    expect((await check(await issuer.sign({ request: { amount: "0.010" } }))).ok).toBe(true);
  });

  it("accepts an aud that names this seller", async () => {
    const token = await issuer.sign({ aud: ["someone-else", "http://localhost:4001"] });
    expect((await check(token)).ok).toBe(true);
  });
});

describe("signature", () => {
  it("rejects a request without a verdict", async () => {
    expect(await rejection(undefined)).toEqual({
      check: "signature",
      reason: "missing X-Verdict header",
    });
  });

  it("rejects edited claims", async () => {
    const [header, , signature] = (await issuer.sign()).split(".");
    const edited = await issuer.sign({ request: { amount: "5" } });
    const forged = [header, edited.split(".")[1], signature].join(".");
    expect((await rejection(forged)).check).toBe("signature");
  });

  it("rejects a token signed by another key under the same kid", async () => {
    const stranger = await createIssuer();
    expect((await rejection(await stranger.sign())).check).toBe("signature");
  });

  it("rejects a kid that isn't in the key set", async () => {
    const token = await issuer.sign({}, { kid: "local-unknown" });
    expect((await rejection(token)).check).toBe("signature");
  });

  it("rejects a kid listed twice in the key set", async () => {
    const twice = {
      ...policy,
      keys: createLocalJWKSet({ keys: [...issuer.jwks.keys, ...issuer.jwks.keys] }),
    };
    const result = await checkVerdict(await issuer.sign(), SALE, twice, NOW);
    expect(!result.ok && result.check).toBe("signature");
  });

  it("rejects any algorithm but ES256", async () => {
    const secret = new TextEncoder().encode("a shared secret anyone could guess");
    const token = await new SignJWT({ verdict: "allow" })
      .setProtectedHeader({ alg: "HS256", kid: "local-test" })
      .sign(secret);
    expect((await rejection(token)).check).toBe("signature");
  });

  it("rejects an unsigned token", async () => {
    const [, payload] = (await issuer.sign()).split(".");
    const none = Buffer.from(JSON.stringify({ alg: "none", kid: "local-test" })).toString(
      "base64url",
    );
    expect((await rejection(`${none}.${payload}.`)).check).toBe("signature");
  });

  it("rejects another issuer", async () => {
    const token = await issuer.sign({ iss: "https://verdicts.saifuro.com" });
    expect((await rejection(token)).check).toBe("signature");
  });

  it("rejects padded or whitespace-broken segments", async () => {
    const token = await issuer.sign();
    const notCompact = { check: "signature", reason: "token is not a compact JWT" };
    expect(await rejection(`${token}=`)).toEqual(notCompact);
    expect(await rejection(token.replace(".", ". "))).toEqual(notCompact);
  });

  it("rejects an oversized token before parsing it", async () => {
    const token = await issuer.sign({ padding: "x".repeat(4096) });
    expect(await rejection(token)).toEqual({ check: "signature", reason: "token is too long" });
  });
});

describe("expiry", () => {
  it("accepts a verdict up to its last second", async () => {
    expect((await check(await issuer.sign(), { now: later(299) })).ok).toBe(true);
  });

  it("rejects it at 5 minutes", async () => {
    expect(await rejection(await issuer.sign(), { now: later(300) })).toEqual({
      check: "expiry",
      reason: "token has expired",
    });
  });

  it("rejects a verdict issued more than 60 seconds in the future", async () => {
    const iat = NOW.getTime() / 1000 + 61;
    const token = await issuer.sign({ iat, exp: iat + 300 });
    expect(await rejection(token)).toEqual({ check: "expiry", reason: "issued in the future" });
  });

  it("tolerates a little clock skew", async () => {
    const iat = NOW.getTime() / 1000 + 60;
    expect((await check(await issuer.sign({ iat, exp: iat + 300 }))).ok).toBe(true);
  });
});

describe("environment", () => {
  it("rejects a sandbox key where only local keys are accepted", async () => {
    const sandbox = await createIssuer("sandbox-test");
    const keys = createLocalJWKSet({ keys: [...issuer.jwks.keys, ...sandbox.jwks.keys] });
    const result = await checkVerdict(await sandbox.sign(), SALE, { ...policy, keys }, NOW);
    expect(result).toEqual({
      ok: false,
      check: "environment",
      reason: 'key "sandbox-test" is not accepted here',
    });
  });

  it("accepts a sandbox key where sandbox keys are configured", async () => {
    const sandbox = await createIssuer("sandbox-test");
    const sandboxPolicy = {
      ...policy,
      keys: createLocalJWKSet(sandbox.jwks),
      kidPrefixes: ["sandbox-"],
    };
    expect((await checkVerdict(await sandbox.sign(), SALE, sandboxPolicy, NOW)).ok).toBe(true);
  });
});

describe("claims", () => {
  it.each(["review", "deny_limit", "deny_no_mandate"])("rejects verdict %s", async (verdict) => {
    expect(await rejection(await issuer.sign({ verdict }))).toEqual({
      check: "claims",
      reason: `verdict is ${verdict}, not allow`,
    });
  });

  it("rejects an allow that names no mandate", async () => {
    expect(await rejection(await issuer.sign({ mandate: null }))).toEqual({
      check: "claims",
      reason: "an allow must name a mandate",
    });
  });

  it.each(["exp", "iat", "nonce", "verdict", "request"])("rejects a missing %s", async (claim) => {
    expect((await rejection(await issuer.sign({ [claim]: undefined }))).check).toBe("claims");
  });

  it.each([
    ["one base unit less", "0.009999"],
    ["one base unit more", "0.010001"],
    ["the price in base units", "10000"],
    ["not an amount", "0.01 USD"],
  ])("rejects an amount that is %s", async (_case, amount) => {
    expect(await rejection(await issuer.sign({ request: { amount } }))).toEqual({
      check: "claims",
      reason: `amount ${amount} does not match the price`,
    });
  });

  it("rejects another currency, compared case-sensitively", async () => {
    expect(await rejection(await issuer.sign({ request: { currency: "usd" } }))).toEqual({
      check: "claims",
      reason: "currency usd is not USD",
    });
  });

  it("rejects a verdict that doesn't name a currency", async () => {
    const token = await issuer.sign({ request: { currency: undefined } });
    expect((await rejection(token)).reason).toBe("currency (missing) is not USD");
  });

  it("rejects another recipient, even the same address in other letter case", async () => {
    const token = await issuer.sign({ request: { recipient: SELLER.toLowerCase() } });
    expect(await rejection(token)).toEqual({
      check: "claims",
      reason: `recipient ${SELLER.toLowerCase()} is not this seller`,
    });
  });

  it("rejects a mandate the operator didn't register with this seller", async () => {
    const stranger = "mnd_ffffffffffffffffffffffffffffffff";
    expect(await rejection(await issuer.sign({ mandate: stranger }))).toEqual({
      check: "claims",
      reason: `mandate ${stranger} is not registered with this seller`,
    });
  });

  it("rejects an aud that names someone else", async () => {
    expect(await rejection(await issuer.sign({ aud: "https://other-seller.example" }))).toEqual({
      check: "claims",
      reason: "token is addressed to someone else",
    });
  });

  it("checks the deal it is given, so a $3 approval can't buy a $0.01 call", async () => {
    const token = await issuer.sign({ request: { amount: "3" } });
    const report: Sale = { ...SALE, amount: toBaseUnits("3") };
    expect((await check(token, { sale: report })).ok).toBe(true);
    expect((await rejection(token)).check).toBe("claims");
  });
});

describe("errors that are not the buyer's", () => {
  it("throws when the key set can't be fetched, rather than blaming the token", async () => {
    const unreachable = { ...policy, keys: () => Promise.reject(new TypeError("fetch failed")) };
    await expect(checkVerdict(await issuer.sign(), SALE, unreachable, NOW)).rejects.toThrow(
      "fetch failed",
    );
  });
});
