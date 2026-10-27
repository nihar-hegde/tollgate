// Tests for the rules the database enforces on its own (ADR 0003, 0005), run
// against a real Postgres (tollgate_db_test, rebuilt by global-setup.ts). Each
// test starts from valid rows and attempts one thing the rules forbid, then
// checks Postgres refused it for the right reason: the constraint it names, or
// the triggers' SQLSTATE. Tests for allowed changes sit next to them, so a rule
// that is too strict fails too.

import { toBaseUnits as dollars } from "@tollgate/shared";
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { agents, decisions, deliveries, idempotencyKeys, mandates, reviews } from "../src/schema";
import {
  AGENT,
  agentRow,
  decisionRow,
  deliveryRow,
  mandateRow,
  RESTRICT_VIOLATION,
  reviewRow,
  useTestDatabase,
} from "./helpers";

const { db, rejectionOf } = useTestDatabase();

const FOREIGN_KEY_VIOLATION = "23503";

beforeEach(async () => {
  await db.insert(agents).values(agentRow());
});

function only<T>(rows: T[]): T {
  const [row] = rows;
  if (row === undefined || rows.length !== 1) {
    throw new Error(`expected exactly one row, got ${rows.length}`);
  }
  return row;
}

async function insertMandate(overrides: Parameters<typeof mandateRow>[0] = {}) {
  return only(await db.insert(mandates).values(mandateRow(overrides)).returning());
}

async function insertDecision(...args: Parameters<typeof decisionRow>) {
  return only(
    await db
      .insert(decisions)
      .values(decisionRow(...args))
      .returning(),
  );
}

function revoke(mandateId: string) {
  return db
    .update(mandates)
    .set({ status: "revoked", revokedAt: new Date() })
    .where(eq(mandates.id, mandateId));
}

describe("agents", () => {
  it("stores an operator-chosen id, enabled by default", async () => {
    const agent = only(await db.select().from(agents).where(eq(agents.id, AGENT)));
    expect(agent.status).toBe("enabled");
  });

  it.each(["research_01", "agt_Research", "agt_", "agt_research-01"])(
    "rejects the id %s",
    async (id) => {
      const error = await rejectionOf(() => db.insert(agents).values(agentRow({ id })));
      expect(error.constraint).toBe("agents_id_format");
    },
  );

  it("rejects a status that isn't enabled or disabled", async () => {
    const error = await rejectionOf(() =>
      // @ts-expect-error: TypeScript blocks this too; the database is the backstop.
      db.insert(agents).values(agentRow({ id: "agt_other", status: "paused" })),
    );
    expect(error.constraint).toBe("agents_status_valid");
  });

  it("can be disabled", async () => {
    await db.update(agents).set({ status: "disabled" }).where(eq(agents.id, AGENT));
    const agent = only(await db.select().from(agents));
    expect(agent.status).toBe("disabled");
  });
});

describe("mandates: what a mandate may contain", () => {
  it("stores a valid mandate, active by default", async () => {
    const mandate = await insertMandate();
    expect(mandate).toMatchObject({ status: "active", revokedAt: null, replacesId: null });
  });

  it.each([
    [
      "per_transaction above per_month",
      { perTransaction: dollars("51") },
      "mandates_per_transaction_within_month",
    ],
    ["a zero limit", { perTransaction: 0n }, "mandates_limits_positive"],
    ["a negative limit", { perMonth: -1n }, "mandates_limits_positive"],
    ["review_above of zero", { reviewAbove: 0n }, "mandates_review_above_positive"],
    ["a lowercase currency", { currency: "usd" }, "mandates_currency_format"],
    ["no categories", { categories: [] }, "mandates_has_categories"],
    ["an empty principal", { principal: "" }, "mandates_principal_length"],
    [
      "revoked with no revoked_at",
      { status: "revoked" as const },
      "mandates_revoked_at_iff_revoked",
    ],
    ["revoked_at while active", { revokedAt: new Date() }, "mandates_revoked_at_iff_revoked"],
  ])("rejects %s", async (_case, overrides, constraint) => {
    const error = await rejectionOf(() => db.insert(mandates).values(mandateRow(overrides)));
    expect(error.constraint).toBe(constraint);
  });

  it("allows a mandate with no review_above", async () => {
    const mandate = await insertMandate({ reviewAbove: null });
    expect(mandate.reviewAbove).toBeNull();
  });

  it("rejects a status that isn't active or revoked", async () => {
    const error = await rejectionOf(() =>
      // @ts-expect-error: TypeScript blocks this too; the database is the backstop.
      db.insert(mandates).values(mandateRow({ status: "paused" })),
    );
    expect(error.constraint).toBe("mandates_status_valid");
  });

  it("rejects a mandate for an agent that doesn't exist", async () => {
    const error = await rejectionOf(() =>
      db.insert(mandates).values(mandateRow({ agentId: "agt_ghost" })),
    );
    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
  });
});

describe("mandates: one active per agent and currency (ADR 0002 rule 1)", () => {
  it("rejects a second active mandate in the same currency", async () => {
    await insertMandate();
    const error = await rejectionOf(() => db.insert(mandates).values(mandateRow()));
    expect(error.constraint).toBe("mandates_one_active_per_agent_currency");
  });

  it("allows an active mandate in another currency", async () => {
    await insertMandate();
    await expect(insertMandate({ currency: "EUR" })).resolves.toBeDefined();
  });

  it("allows another agent its own active mandate", async () => {
    await insertMandate();
    await db.insert(agents).values(agentRow({ id: "agt_other" }));
    await expect(insertMandate({ agentId: "agt_other" })).resolves.toBeDefined();
  });

  it("allows replacing: revoke the old one, then create its successor", async () => {
    const old = await insertMandate();
    await revoke(old.id);
    const successor = await insertMandate({ perTransaction: dollars("1"), replacesId: old.id });

    const history = await db.select().from(mandates).where(eq(mandates.agentId, AGENT));
    expect(history).toHaveLength(2);
    expect(successor).toMatchObject({ status: "active", replacesId: old.id });
  });

  it("rejects replacing the same mandate twice", async () => {
    const old = await insertMandate();
    await revoke(old.id);
    const first = await insertMandate({ replacesId: old.id });
    await revoke(first.id);

    const error = await rejectionOf(() =>
      db.insert(mandates).values(mandateRow({ replacesId: old.id })),
    );
    expect(error.constraint).toBe("mandates_replaced_once");
  });
});

describe("mandates: the only change allowed is revoking", () => {
  it("allows active → revoked, leaving everything else as it was", async () => {
    const before = await insertMandate();
    await revoke(before.id);

    const after = only(await db.select().from(mandates).where(eq(mandates.id, before.id)));
    expect(after.status).toBe("revoked");
    expect(after.revokedAt).toBeInstanceOf(Date);
    expect({ ...after, status: before.status, revokedAt: null }).toEqual(before);
  });

  it("rejects revoking without recording when", async () => {
    const mandate = await insertMandate();
    const error = await rejectionOf(() =>
      db.update(mandates).set({ status: "revoked" }).where(eq(mandates.id, mandate.id)),
    );
    expect(error.constraint).toBe("mandates_revoked_at_iff_revoked");
  });

  it.each([
    ["per_transaction", { perTransaction: dollars("1") }],
    ["per_month", { perMonth: dollars("100") }],
    ["categories", { categories: ["data", "travel"] }],
    ["review_above", { reviewAbove: null }],
    ["expires", { expires: "2027-12-31" }],
    ["principal", { principal: "role:someone_else" }],
    ["currency", { currency: "EUR" }],
    ["created_at", { createdAt: new Date("2020-01-01") }],
  ])("rejects editing %s", async (_column, change) => {
    const mandate = await insertMandate();
    const error = await rejectionOf(() =>
      db.update(mandates).set(change).where(eq(mandates.id, mandate.id)),
    );
    expect(error.code).toBe(RESTRICT_VIOLATION);
  });

  it("rejects editing a limit in the same statement as revoking", async () => {
    const mandate = await insertMandate();
    const error = await rejectionOf(() =>
      db
        .update(mandates)
        .set({ status: "revoked", revokedAt: new Date(), perMonth: dollars("500") })
        .where(eq(mandates.id, mandate.id)),
    );
    expect(error.code).toBe(RESTRICT_VIOLATION);
  });

  it("rejects un-revoking", async () => {
    const mandate = await insertMandate();
    await revoke(mandate.id);
    const error = await rejectionOf(() =>
      db
        .update(mandates)
        .set({ status: "active", revokedAt: null })
        .where(eq(mandates.id, mandate.id)),
    );
    expect(error.code).toBe(RESTRICT_VIOLATION);
  });

  it("rejects revoking twice (the first revoked_at stands)", async () => {
    const mandate = await insertMandate();
    await revoke(mandate.id);
    const error = await rejectionOf(() => revoke(mandate.id));
    expect(error.code).toBe(RESTRICT_VIOLATION);
  });

  it("rejects deleting a mandate", async () => {
    const mandate = await insertMandate();
    const error = await rejectionOf(() => db.delete(mandates).where(eq(mandates.id, mandate.id)));
    expect(error.code).toBe(RESTRICT_VIOLATION);
  });
});

describe("decisions: what a decision may contain", () => {
  it("stores a decision made under a mandate", async () => {
    const mandate = await insertMandate();
    const decision = await insertDecision(mandate.id);
    expect(decision).toMatchObject({ verdict: "allow", mandateId: mandate.id, amount: 10_000n });
  });

  it("logs a request from an unknown agent, with no mandate (ADR 0002 rule 5)", async () => {
    const decision = await insertDecision(null, {
      agentId: "agt_ghost",
      verdict: "deny_no_mandate",
      reason: "unknown agent agt_ghost",
    });
    expect(decision).toMatchObject({ agentId: "agt_ghost", mandateId: null });
  });

  it("rejects a verdict other than deny_no_mandate without a mandate", async () => {
    const error = await rejectionOf(() => db.insert(decisions).values(decisionRow(null)));
    expect(error.constraint).toBe("decisions_mandate_iff_not_no_mandate");
  });

  it("rejects deny_no_mandate that names a mandate", async () => {
    const mandate = await insertMandate();
    const error = await rejectionOf(() =>
      db.insert(decisions).values(decisionRow(mandate.id, { verdict: "deny_no_mandate" })),
    );
    expect(error.constraint).toBe("decisions_mandate_iff_not_no_mandate");
  });

  it("rejects a mandate id that doesn't exist", async () => {
    const error = await rejectionOf(() => db.insert(decisions).values(decisionRow("mnd_missing")));
    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("rejects a misspelt verdict", async () => {
    const mandate = await insertMandate();
    const error = await rejectionOf(() =>
      // @ts-expect-error: TypeScript blocks this too; the database is the backstop.
      db.insert(decisions).values(decisionRow(mandate.id, { verdict: "alow" })),
    );
    expect(error.constraint).toBe("decisions_verdict_valid");
  });

  it("rejects an unknown mode", async () => {
    const mandate = await insertMandate();
    const error = await rejectionOf(() =>
      // @ts-expect-error: TypeScript blocks this too; the database is the backstop.
      db.insert(decisions).values(decisionRow(mandate.id, { mode: "audit" })),
    );
    expect(error.constraint).toBe("decisions_mode_valid");
  });

  it("rejects an unknown protocol, but allows none", async () => {
    const mandate = await insertMandate();
    const error = await rejectionOf(() =>
      // @ts-expect-error: TypeScript blocks this too; the database is the backstop.
      db.insert(decisions).values(decisionRow(mandate.id, { protocol: "swift" })),
    );
    expect(error.constraint).toBe("decisions_protocol_valid");
    await expect(insertDecision(mandate.id, { protocol: null })).resolves.toBeDefined();
  });

  it("rejects a zero amount", async () => {
    const mandate = await insertMandate();
    const error = await rejectionOf(() =>
      db.insert(decisions).values(decisionRow(mandate.id, { amount: 0n })),
    );
    expect(error.constraint).toBe("decisions_amount_positive");
  });

  it("rejects a verdict nonce that was already issued", async () => {
    const mandate = await insertMandate();
    await insertDecision(mandate.id, { nonce: "n_reused" });
    const error = await rejectionOf(() =>
      db.insert(decisions).values(decisionRow(mandate.id, { nonce: "n_reused" })),
    );
    expect(error.constraint).toBe("decisions_nonce_unique");
  });
});

describe("decisions: append-only", () => {
  let decisionId: string;

  beforeEach(async () => {
    const mandate = await insertMandate();
    decisionId = (await insertDecision(mandate.id)).id;
  });

  it.each([
    ["the reason", { reason: "edited later" }],
    ["the verdict", { verdict: "deny_limit" as const }],
    ["the amount", { amount: dollars("0.02") }],
  ])("rejects updating %s", async (_field, change) => {
    const error = await rejectionOf(() =>
      db.update(decisions).set(change).where(eq(decisions.id, decisionId)),
    );
    expect(error.code).toBe(RESTRICT_VIOLATION);
  });

  it("rejects deleting a decision", async () => {
    const error = await rejectionOf(() => db.delete(decisions).where(eq(decisions.id, decisionId)));
    expect(error.code).toBe(RESTRICT_VIOLATION);
  });

  it("rejects truncating the log", async () => {
    const error = await rejectionOf(() => db.execute(sql`truncate decisions cascade`));
    expect(error.code).toBe(RESTRICT_VIOLATION);
  });

  it("rejects truncating it indirectly, through a cascade from agents", async () => {
    const error = await rejectionOf(() => db.execute(sql`truncate agents cascade`));
    expect(error.code).toBe(RESTRICT_VIOLATION);
  });
});

describe("decisions: approving a review", () => {
  let mandateId: string;
  let reviewDecisionId: string;

  beforeEach(async () => {
    mandateId = (await insertMandate()).id;
    const reviewDecision = await insertDecision(mandateId, {
      verdict: "review",
      amount: dollars("3"),
    });
    reviewDecisionId = reviewDecision.id;
  });

  it("allows an allow that supersedes the review decision", async () => {
    const approval = await insertDecision(mandateId, {
      amount: dollars("3"),
      supersedesId: reviewDecisionId,
    });
    expect(approval.supersedesId).toBe(reviewDecisionId);
  });

  it("rejects supersedes on anything but an allow", async () => {
    const error = await rejectionOf(() =>
      db
        .insert(decisions)
        .values(decisionRow(mandateId, { verdict: "deny_limit", supersedesId: reviewDecisionId })),
    );
    expect(error.constraint).toBe("decisions_supersedes_only_on_allow");
  });

  it("rejects a second allow superseding the same review", async () => {
    await insertDecision(mandateId, { supersedesId: reviewDecisionId });
    const error = await rejectionOf(() =>
      db.insert(decisions).values(decisionRow(mandateId, { supersedesId: reviewDecisionId })),
    );
    expect(error.constraint).toBe("decisions_supersedes_once");
  });
});

describe("reviews: resolved once", () => {
  let decisionId: string;
  let reviewId: string;

  beforeEach(async () => {
    const mandate = await insertMandate();
    decisionId = (await insertDecision(mandate.id, { verdict: "review" })).id;
    reviewId = only(await db.insert(reviews).values(reviewRow(decisionId)).returning()).id;
  });

  function resolve(status: "approved" | "denied") {
    return db
      .update(reviews)
      .set({ status, resolvedAt: new Date() })
      .where(eq(reviews.id, reviewId));
  }

  it("starts pending", async () => {
    const review = only(await db.select().from(reviews));
    expect(review).toMatchObject({ status: "pending", resolvedAt: null });
  });

  it.each(["approved", "denied"] as const)("allows pending → %s", async (status) => {
    await resolve(status);
    const review = only(await db.select().from(reviews));
    expect(review.status).toBe(status);
  });

  it("rejects a second review for the same decision", async () => {
    const error = await rejectionOf(() => db.insert(reviews).values(reviewRow(decisionId)));
    expect(error.constraint).toBe("reviews_decision_id_unique");
  });

  it("rejects resolving without recording when", async () => {
    const error = await rejectionOf(() =>
      db.update(reviews).set({ status: "approved" }).where(eq(reviews.id, reviewId)),
    );
    expect(error.constraint).toBe("reviews_resolved_at_iff_resolved");
  });

  it("rejects changing the outcome once resolved", async () => {
    await resolve("approved");
    const error = await rejectionOf(() => resolve("denied"));
    expect(error.code).toBe(RESTRICT_VIOLATION);
  });

  it("rejects reopening a resolved review", async () => {
    await resolve("denied");
    const error = await rejectionOf(() =>
      db
        .update(reviews)
        .set({ status: "pending", resolvedAt: null })
        .where(eq(reviews.id, reviewId)),
    );
    expect(error.code).toBe(RESTRICT_VIOLATION);
  });

  it("rejects extending the expiry", async () => {
    const error = await rejectionOf(() =>
      db
        .update(reviews)
        .set({ expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000) })
        .where(eq(reviews.id, reviewId)),
    );
    expect(error.code).toBe(RESTRICT_VIOLATION);
  });

  it("rejects a stored 'expired' status (expiry is computed)", async () => {
    const mandate = only(await db.select().from(mandates));
    const other = await insertDecision(mandate.id, { verdict: "review" });
    const error = await rejectionOf(() =>
      // @ts-expect-error: TypeScript blocks this too; the database is the backstop.
      db.insert(reviews).values(reviewRow(other.id, { status: "expired", resolvedAt: new Date() })),
    );
    expect(error.constraint).toBe("reviews_status_valid");
  });

  it("rejects deleting a review", async () => {
    const error = await rejectionOf(() => db.delete(reviews).where(eq(reviews.id, reviewId)));
    expect(error.code).toBe(RESTRICT_VIOLATION);
  });
});

describe("idempotency keys", () => {
  let decisionId: string;

  beforeEach(async () => {
    const mandate = await insertMandate();
    decisionId = (await insertDecision(mandate.id)).id;
  });

  function keyRow(key: string) {
    return { key, requestHash: "sha256-of-body", decisionId };
  }

  it("rejects the same key twice, so concurrent retries can't both decide", async () => {
    await db.insert(idempotencyKeys).values(keyRow("purchase-1"));
    const error = await rejectionOf(() => db.insert(idempotencyKeys).values(keyRow("purchase-1")));
    expect(error.constraint).toBe("idempotency_keys_pkey");
  });

  it("rejects an empty key", async () => {
    const error = await rejectionOf(() => db.insert(idempotencyKeys).values(keyRow("")));
    expect(error.constraint).toBe("idempotency_keys_key_length");
  });

  it("rejects a key pointing at no decision", async () => {
    const error = await rejectionOf(() =>
      db.insert(idempotencyKeys).values({ ...keyRow("purchase-1"), decisionId: "dec_missing" }),
    );
    expect(error.code).toBe(FOREIGN_KEY_VIOLATION);
  });

  it("can be reused after 24h and cleaned up (it is not part of the audit log)", async () => {
    await db.insert(idempotencyKeys).values(keyRow("purchase-1"));
    await db
      .update(idempotencyKeys)
      .set({ requestHash: "sha256-of-new-body" })
      .where(eq(idempotencyKeys.key, "purchase-1"));
    await db.delete(idempotencyKeys).where(eq(idempotencyKeys.key, "purchase-1"));
    expect(await db.select().from(idempotencyKeys)).toHaveLength(0);
  });
});

describe("deliveries: one per verdict", () => {
  it("starts pending, with no transaction yet", async () => {
    const delivery = only(await db.insert(deliveries).values(deliveryRow()).returning());
    expect(delivery).toMatchObject({ status: "pending", txHash: null, completedAt: null });
  });

  it("rejects a verdict nonce seen before: the seller's replay check", async () => {
    await db.insert(deliveries).values(deliveryRow({ verdictNonce: "n_replayed" }));
    const error = await rejectionOf(() =>
      db.insert(deliveries).values(deliveryRow({ verdictNonce: "n_replayed" })),
    );
    expect(error.constraint).toBe("deliveries_verdict_nonce_unique");
  });

  it("rejects a second allow superseding the same review", async () => {
    await db.insert(deliveries).values(deliveryRow({ supersedesId: "dec_review" }));
    const error = await rejectionOf(() =>
      db.insert(deliveries).values(deliveryRow({ supersedesId: "dec_review" })),
    );
    expect(error.constraint).toBe("deliveries_supersedes_once");
  });

  it("rejects a zero amount", async () => {
    const error = await rejectionOf(() =>
      db.insert(deliveries).values(deliveryRow({ amount: 0n })),
    );
    expect(error.constraint).toBe("deliveries_amount_positive");
  });
});

describe("deliveries: completed once", () => {
  const TX = `0x${"ab".repeat(32)}`;
  let deliveryId: string;

  beforeEach(async () => {
    deliveryId = only(await db.insert(deliveries).values(deliveryRow()).returning()).id;
  });

  function complete(change: Partial<typeof deliveries.$inferInsert>) {
    return db
      .update(deliveries)
      .set({ completedAt: new Date(), ...change })
      .where(eq(deliveries.id, deliveryId));
  }

  const settle = (txHash = TX) => complete({ status: "settled", txHash, payer: "0xpayer" });

  it("allows pending → settled with the transaction hash", async () => {
    await settle();
    const delivery = only(await db.select().from(deliveries));
    expect(delivery).toMatchObject({ status: "settled", txHash: TX });
  });

  it("allows pending → failed with the reason", async () => {
    await complete({ status: "failed", failure: "insufficient_funds" });
    const delivery = only(await db.select().from(deliveries));
    expect(delivery).toMatchObject({ status: "failed", failure: "insufficient_funds" });
  });

  it("rejects settling without a transaction hash", async () => {
    const error = await rejectionOf(() => complete({ status: "settled" }));
    expect(error.constraint).toBe("deliveries_tx_hash_iff_settled");
  });

  it("rejects failing without a reason", async () => {
    const error = await rejectionOf(() => complete({ status: "failed" }));
    expect(error.constraint).toBe("deliveries_failure_iff_failed");
  });

  it("rejects completing without recording when", async () => {
    const error = await rejectionOf(() =>
      db
        .update(deliveries)
        .set({ status: "settled", txHash: TX })
        .where(eq(deliveries.id, deliveryId)),
    );
    expect(error.constraint).toBe("deliveries_completed_at_iff_completed");
  });

  it("rejects a malformed transaction hash", async () => {
    const error = await rejectionOf(() => settle("0x1234"));
    expect(error.constraint).toBe("deliveries_tx_hash_format");
  });

  it("rejects one transaction settling two deliveries", async () => {
    await settle();
    const other = only(await db.insert(deliveries).values(deliveryRow()).returning());
    const error = await rejectionOf(() =>
      db
        .update(deliveries)
        .set({ status: "settled", txHash: TX, completedAt: new Date() })
        .where(eq(deliveries.id, other.id)),
    );
    expect(error.constraint).toBe("deliveries_tx_hash_once");
  });

  it("rejects changing the outcome once completed", async () => {
    await complete({ status: "failed", failure: "timeout" });
    const error = await rejectionOf(() =>
      complete({ status: "settled", txHash: TX, failure: null }),
    );
    expect(error.code).toBe(RESTRICT_VIOLATION);
  });

  it("rejects editing what was delivered", async () => {
    const error = await rejectionOf(() =>
      db
        .update(deliveries)
        .set({ amount: dollars("5") })
        .where(eq(deliveries.id, deliveryId)),
    );
    expect(error.code).toBe(RESTRICT_VIOLATION);
  });

  it("rejects deleting a delivery", async () => {
    const error = await rejectionOf(() =>
      db.delete(deliveries).where(eq(deliveries.id, deliveryId)),
    );
    expect(error.code).toBe(RESTRICT_VIOLATION);
  });
});

describe("money", () => {
  it("round-trips amounts beyond float precision exactly, as bigint", async () => {
    // 2^53 + 1: the first integer a JavaScript number can't hold.
    const huge = 9_007_199_254_740_993n;
    const mandate = await insertMandate({ perTransaction: huge, perMonth: huge });
    const stored = only(await db.select().from(mandates).where(eq(mandates.id, mandate.id)));
    expect(stored.perMonth).toBe(huge);
  });
});
