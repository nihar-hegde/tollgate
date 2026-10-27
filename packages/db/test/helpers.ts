// Shared setup for the database tests: a connection whose every test runs in
// a transaction that is rolled back afterwards, a way to capture the error a
// rejected statement raises, and valid rows to start each test from.

import { newId, toBaseUnits as dollars } from "@tollgate/shared";
import { drizzle } from "drizzle-orm/node-postgres";
import { Client, DatabaseError } from "pg";
import { afterAll, afterEach, beforeAll, beforeEach } from "vitest";
import * as schema from "../src/schema";
import { TEST_DATABASE_URL } from "./test-database";

// SQLSTATE raised by the triggers in drizzle/0001_triggers.sql.
export const RESTRICT_VIOLATION = "23001";

export function useTestDatabase() {
  const client = new Client({ connectionString: TEST_DATABASE_URL });
  const db = drizzle(client, { schema });

  beforeAll(() => client.connect());
  afterAll(() => client.end());
  // Nothing a test writes survives it, so tests can't affect each other.
  beforeEach(() => client.query("BEGIN"));
  afterEach(() => client.query("ROLLBACK"));

  /**
   * Runs a statement the database should refuse and returns Postgres's error.
   * The savepoint undoes the failed statement, so the test's transaction stays
   * usable afterwards. Fails the test if the statement succeeds.
   */
  async function rejectionOf(attempt: () => PromiseLike<unknown>): Promise<DatabaseError> {
    await client.query("SAVEPOINT attempt");
    try {
      await attempt();
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT attempt");
      return postgresError(error);
    }
    await client.query("RELEASE SAVEPOINT attempt");
    throw new Error("expected the database to reject this statement, but it succeeded");
  }

  return { db, rejectionOf };
}

// Drizzle wraps driver errors; the Postgres error is its cause.
function postgresError(error: unknown): DatabaseError {
  if (error instanceof DatabaseError) return error;
  if (error instanceof Error && error.cause instanceof DatabaseError) return error.cause;
  throw error;
}

export const AGENT = "agt_research_01";
const SELLER = "0xC625dAc9148Fa7eE8255a56Bcb07Dc4AC56ffcF0";

type AgentRow = typeof schema.agents.$inferInsert;
type MandateRow = typeof schema.mandates.$inferInsert;
type DecisionRow = typeof schema.decisions.$inferInsert;
type ReviewRow = typeof schema.reviews.$inferInsert;

export function agentRow(overrides: Partial<AgentRow> = {}): AgentRow {
  return { id: AGENT, name: "Research agent", ...overrides };
}

// The mandate from the user stories: $5 per call, $50 per 30 days, data,
// review above $2, valid through 2026.
export function mandateRow(overrides: Partial<MandateRow> = {}): MandateRow {
  return {
    id: newId("mandate"),
    agentId: AGENT,
    principal: "role:research_lead",
    perTransaction: dollars("5"),
    perMonth: dollars("50"),
    currency: "USD",
    categories: ["data"],
    reviewAbove: dollars("2"),
    expires: "2026-12-31",
    ...overrides,
  };
}

// An allowed $0.01 purchase. Pass the mandate it was decided under.
export function decisionRow(
  mandateId: string | null,
  overrides: Partial<DecisionRow> = {},
): DecisionRow {
  return {
    id: newId("decision"),
    agentId: AGENT,
    amount: dollars("0.01"),
    currency: "USD",
    recipient: SELLER,
    category: "data",
    protocol: "x402",
    verdict: "allow",
    reason: "passed all checks",
    mandateId,
    policyVersion: "pol_local.1",
    nonce: newId("nonce"),
    mode: "enforce",
    issuedAt: new Date(),
    verdictToken: "header.payload.signature",
    ...overrides,
  };
}

export function reviewRow(decisionId: string, overrides: Partial<ReviewRow> = {}): ReviewRow {
  return {
    id: newId("review"),
    decisionId,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
    ...overrides,
  };
}
