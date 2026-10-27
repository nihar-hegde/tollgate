// The authorizer's, seller's and indexer's tables. Rules that must hold whoever
// writes to the database live here as constraints; the ones that compare a row
// with its previous version are triggers in drizzle/0001, 0003 and 0005.
// ADR 0003, 0005, 0007.
//
// Conventions:
// - Money is bigint USDC base units, never a float or numeric.
// - Vocabularies (verdicts, statuses) are text plus a CHECK built from the
//   lists in @tollgate/shared, so the code and the database can't drift apart.
// - Columns are snake_case with `id` keys; the API maps them to Saifuro's
//   field names (`decision`, `mandate`, ...).

import {
  AGENT_STATUSES,
  DELIVERY_STATUSES,
  MANDATE_STATUSES,
  MODES,
  PROTOCOLS,
  REVIEW_STATUSES,
  VERDICTS,
} from "@tollgate/shared";
import { sql, type SQL } from "drizzle-orm";
import {
  bigint,
  check,
  date,
  index,
  integer,
  primaryKey,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// `column in ('a', 'b', ...)`. Values come from our own constant lists, never
// from user input, so inlining them is safe.
function oneOf(column: AnyPgColumn, values: readonly string[]): SQL {
  const list = values.map((value) => `'${value}'`).join(", ");
  return sql`${column} in (${sql.raw(list)})`;
}

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

const baseUnits = (name: string) => bigint(name, { mode: "bigint" });

export const agents = pgTable(
  "agents",
  {
    // Chosen by the operator, e.g. agt_research_01.
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    status: text("status", { enum: AGENT_STATUSES }).notNull().default("enabled"),
    createdAt: createdAt(),
  },
  (t) => [
    check("agents_id_format", sql`${t.id} ~ '^agt_[a-z0-9_]{1,64}$'`),
    check("agents_status_valid", oneOf(t.status, AGENT_STATUSES)),
  ],
);

export const mandates = pgTable(
  "mandates",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    principal: text("principal").notNull(),
    perTransaction: baseUnits("per_transaction").notNull(),
    perMonth: baseUnits("per_month").notNull(),
    currency: text("currency").notNull(),
    categories: text("categories").array().notNull(),
    // Null means nothing on this mandate ever goes to review.
    reviewAbove: baseUnits("review_above"),
    // Valid through the end of this day, UTC (ADR 0002 rule 2).
    expires: date("expires").notNull(),
    status: text("status", { enum: MANDATE_STATUSES }).notNull().default("active"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    // The mandate this one took over from, when limits were changed.
    replacesId: text("replaces_id").references((): AnyPgColumn => mandates.id),
    createdAt: createdAt(),
  },
  (t) => [
    // ADR 0002 rule 1: at most one active mandate per agent and currency.
    uniqueIndex("mandates_one_active_per_agent_currency")
      .on(t.agentId, t.currency)
      .where(sql`status = 'active'`),
    // A mandate is replaced at most once; the history is a straight line.
    uniqueIndex("mandates_replaced_once").on(t.replacesId),
    check("mandates_status_valid", oneOf(t.status, MANDATE_STATUSES)),
    check(
      "mandates_revoked_at_iff_revoked",
      sql`(${t.status} = 'revoked') = (${t.revokedAt} is not null)`,
    ),
    check("mandates_limits_positive", sql`${t.perTransaction} > 0 and ${t.perMonth} > 0`),
    check("mandates_per_transaction_within_month", sql`${t.perTransaction} <= ${t.perMonth}`),
    check("mandates_review_above_positive", sql`${t.reviewAbove} is null or ${t.reviewAbove} > 0`),
    check("mandates_currency_format", sql`${t.currency} ~ '^[A-Z]{3}$'`),
    check("mandates_has_categories", sql`cardinality(${t.categories}) >= 1`),
    check("mandates_principal_length", sql`length(${t.principal}) between 1 and 128`),
  ],
);

export const decisions = pgTable(
  "decisions",
  {
    id: text("id").primaryKey(),
    // Not a foreign key: requests naming an unknown agent are logged too
    // (ADR 0002 rule 5).
    agentId: text("agent_id").notNull(),
    // The request, one column per field, so spend can be summed in SQL.
    amount: baseUnits("amount").notNull(),
    currency: text("currency").notNull(),
    recipient: text("recipient").notNull(),
    category: text("category").notNull(),
    protocol: text("protocol", { enum: PROTOCOLS }),
    verdict: text("verdict", { enum: VERDICTS }).notNull(),
    reason: text("reason").notNull(),
    // Null only for deny_no_mandate.
    mandateId: text("mandate_id").references(() => mandates.id),
    policyVersion: text("policy_version").notNull(),
    // The verdict nonce. The seller's replay check relies on it being unique.
    nonce: text("nonce").notNull().unique(),
    mode: text("mode", { enum: MODES }).notNull(),
    issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
    verdictToken: text("verdict_token").notNull(),
    // On an allow issued by approving a review: the review decision it replaces.
    supersedesId: text("supersedes_id").references((): AnyPgColumn => decisions.id),
  },
  (t) => [
    // Velocity (last 60s) and 30-day spend both read one agent's recent rows.
    index("decisions_agent_issued_at").on(t.agentId, t.issuedAt),
    // A review can be approved into exactly one allow.
    uniqueIndex("decisions_supersedes_once").on(t.supersedesId),
    check("decisions_verdict_valid", oneOf(t.verdict, VERDICTS)),
    check("decisions_mode_valid", oneOf(t.mode, MODES)),
    check(
      "decisions_protocol_valid",
      sql`${t.protocol} is null or ${oneOf(t.protocol, PROTOCOLS)}`,
    ),
    check("decisions_amount_positive", sql`${t.amount} > 0`),
    check(
      "decisions_mandate_iff_not_no_mandate",
      sql`(${t.verdict} = 'deny_no_mandate') = (${t.mandateId} is null)`,
    ),
    check(
      "decisions_supersedes_only_on_allow",
      sql`${t.supersedesId} is null or ${t.verdict} = 'allow'`,
    ),
  ],
);

export const reviews = pgTable(
  "reviews",
  {
    id: text("id").primaryKey(),
    // The decision whose verdict was `review`.
    decisionId: text("decision_id")
      .notNull()
      .unique()
      .references(() => decisions.id),
    status: text("status", { enum: REVIEW_STATUSES }).notNull().default("pending"),
    // 24 hours after the review decision was issued.
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    check("reviews_status_valid", oneOf(t.status, REVIEW_STATUSES)),
    check(
      "reviews_resolved_at_iff_resolved",
      sql`(${t.status} = 'pending') = (${t.resolvedAt} is null)`,
    ),
  ],
);

// Same key and same body within 24 hours returns the original decision. Only
// stored with a decision, so a 5xx (no decision) is never remembered.
export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    key: text("key").primaryKey(),
    // SHA-256 of the request body, to tell a true retry from a reused key.
    requestHash: text("request_hash").notNull(),
    decisionId: text("decision_id")
      .notNull()
      .references(() => decisions.id),
    createdAt: createdAt(),
  },
  (t) => [check("idempotency_keys_key_length", sql`length(${t.key}) between 1 and 255`)],
);

// The seller's record of every verdict it accepted. Inserting the row is the
// replay check: the verdict nonce is unique, so a reused verdict can't insert
// again, even on another seller instance. ADR 0005.
export const deliveries = pgTable(
  "deliveries",
  {
    id: text("id").primaryKey(),
    // Copied from the verdict. Not foreign keys: a seller only knows what the token says.
    decisionId: text("decision_id").notNull(),
    verdictNonce: text("verdict_nonce").notNull().unique(),
    supersedesId: text("supersedes_id"),
    mandateId: text("mandate_id").notNull(),
    agentId: text("agent_id").notNull(),
    amount: baseUnits("amount").notNull(),
    recipient: text("recipient").notNull(),
    // The route that was paid for, e.g. "GET /v1/insight".
    resource: text("resource").notNull(),
    verdictToken: text("verdict_token").notNull(),
    status: text("status", { enum: DELIVERY_STATUSES }).notNull().default("pending"),
    // The wallet that signed the payment, then the USDC transfer once settled.
    payer: text("payer"),
    txHash: text("tx_hash"),
    // The EIP-3009 nonce inside the signed payment (not the verdict nonce). The
    // USDC contract logs it on-chain, so the indexer can match a transfer to
    // this row even if the seller never recorded the tx hash.
    authorizationNonce: text("authorization_nonce"),
    // Set when failed: why the payment didn't go through.
    failure: text("failure"),
    createdAt: createdAt(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [
    // The authorizer looks deliveries up by decision when it sums spend.
    index("deliveries_decision").on(t.decisionId),
    index("deliveries_authorization_nonce").on(t.authorizationNonce),
    // Saifuro's seller guide: refuse a second allow superseding the same review.
    uniqueIndex("deliveries_supersedes_once").on(t.supersedesId),
    uniqueIndex("deliveries_tx_hash_once").on(t.txHash),
    check("deliveries_status_valid", oneOf(t.status, DELIVERY_STATUSES)),
    check("deliveries_amount_positive", sql`${t.amount} > 0`),
    check(
      "deliveries_completed_at_iff_completed",
      sql`(${t.status} = 'pending') = (${t.completedAt} is null)`,
    ),
    check(
      "deliveries_tx_hash_iff_settled",
      sql`(${t.status} = 'settled') = (${t.txHash} is not null)`,
    ),
    check(
      "deliveries_failure_iff_failed",
      sql`(${t.status} = 'failed') = (${t.failure} is not null)`,
    ),
    check("deliveries_tx_hash_format", sql`${t.txHash} ~ '^0x[0-9a-f]{64}$'`),
    check(
      "deliveries_authorization_nonce_format",
      sql`${t.authorizationNonce} ~ '^0x[0-9a-f]{64}$'`,
    ),
  ],
);

// USDC transfers to the seller, read from Base Sepolia by the indexer, its only
// writer. Append-only: the chain is the record. ADR 0007.
export const settlements = pgTable(
  "settlements",
  {
    txHash: text("tx_hash").notNull(),
    logIndex: integer("log_index").notNull(),
    blockNumber: bigint("block_number", { mode: "bigint" }).notNull(),
    fromAddress: text("from_address").notNull(),
    toAddress: text("to_address").notNull(),
    value: baseUnits("value").notNull(),
    // From the same transaction's AuthorizationUsed event; null for a direct transfer.
    authorizationNonce: text("authorization_nonce"),
    createdAt: createdAt(),
  },
  (t) => [
    // Re-reading a block can't store a transfer twice.
    primaryKey({ name: "settlements_pkey", columns: [t.txHash, t.logIndex] }),
    index("settlements_authorization_nonce").on(t.authorizationNonce),
    check("settlements_tx_hash_format", sql`${t.txHash} ~ '^0x[0-9a-f]{64}$'`),
    check(
      "settlements_authorization_nonce_format",
      sql`${t.authorizationNonce} ~ '^0x[0-9a-f]{64}$'`,
    ),
    check("settlements_value_not_negative", sql`${t.value} >= 0`),
    check("settlements_position_valid", sql`${t.logIndex} >= 0 and ${t.blockNumber} >= 0`),
  ],
);

// Where each indexer stream has read up to, so a restart neither skips nor repeats blocks.
export const chainCursors = pgTable(
  "chain_cursors",
  {
    stream: text("stream").primaryKey(),
    lastBlock: bigint("last_block", { mode: "bigint" }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("chain_cursors_last_block_valid", sql`${t.lastBlock} >= 0`)],
);
