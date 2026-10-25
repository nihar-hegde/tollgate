import { describe, expect, it } from "vitest";
import { AuthorizationRequest, DollarAmount, MandateInput } from "./schemas";

const SELLER = "0xC625dAc9148Fa7eE8255a56Bcb07Dc4AC56ffcF0";

const validRequest = {
  agent: "agt_research_01",
  amount: "0.01",
  currency: "USD",
  recipient: SELLER,
  category: "data",
  protocol: "x402",
};

const validMandate = {
  agent: "agt_research_01",
  principal: "role:research_lead",
  limits: { per_transaction: "5", per_month: "50", currency: "USD" },
  categories: ["data"],
  review_above: "2",
  expires: "2026-12-31",
};

describe("DollarAmount", () => {
  it("parses to base units", () => {
    expect(DollarAmount.parse("0.01")).toBe(10_000n);
  });

  it("passes on toBaseUnits' reason", () => {
    const result = DollarAmount.safeParse("1.1234567");
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/more than 6 decimals/);
  });

  it("rejects a JSON number", () => {
    expect(DollarAmount.safeParse(0.01).success).toBe(false);
  });
});

describe("AuthorizationRequest", () => {
  it("parses a valid request, with the amount in base units", () => {
    expect(AuthorizationRequest.parse(validRequest)).toEqual({ ...validRequest, amount: 10_000n });
  });

  it("allows protocol to be left out", () => {
    const { protocol, ...rest } = validRequest;
    expect(AuthorizationRequest.safeParse(rest).success).toBe(true);
  });

  it("accepts a currency with no mandate (that's a deny, not a bad request)", () => {
    expect(AuthorizationRequest.safeParse({ ...validRequest, currency: "EUR" }).success).toBe(true);
  });

  it.each([
    ["numeric amount", { amount: 0.01 }],
    ["zero amount", { amount: "0" }],
    ["uppercase category", { category: "Data" }],
    ["category with a dash", { category: "cloud-compute" }],
    ["lowercase currency", { currency: "usd" }],
    ["recipient that isn't an address", { recipient: "vendor:acme_saas" }],
    ["short address", { recipient: "0x1234" }],
    ["malformed agent id", { agent: "research_01" }],
    ["unknown protocol", { protocol: "paypal" }],
    ["unknown extra field", { note: "hi" }],
  ])("rejects a %s", (_name, change) => {
    expect(AuthorizationRequest.safeParse({ ...validRequest, ...change }).success).toBe(false);
  });

  it.each(["agent", "amount", "currency", "recipient", "category"])(
    "rejects a request missing %s",
    (field) => {
      const request: Record<string, unknown> = { ...validRequest };
      delete request[field];
      expect(AuthorizationRequest.safeParse(request).success).toBe(false);
    },
  );
});

describe("MandateInput", () => {
  it("parses a valid mandate, with limits in base units", () => {
    const mandate = MandateInput.parse(validMandate);
    expect(mandate.limits).toEqual({
      per_transaction: 5_000_000n,
      per_month: 50_000_000n,
      currency: "USD",
    });
    expect(mandate.review_above).toBe(2_000_000n);
  });

  it("allows review_above to be left out", () => {
    const { review_above, ...rest } = validMandate;
    expect(MandateInput.safeParse(rest).success).toBe(true);
  });

  it("allows per_transaction equal to per_month", () => {
    const limits = { ...validMandate.limits, per_transaction: "50" };
    expect(MandateInput.safeParse({ ...validMandate, limits }).success).toBe(true);
  });

  it("rejects per_transaction above per_month", () => {
    const limits = { ...validMandate.limits, per_transaction: "60" };
    const result = MandateInput.safeParse({ ...validMandate, limits });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toMatch(/per_transaction cannot exceed per_month/);
  });

  it.each([
    ["currency other than USD", { limits: { ...validMandate.limits, currency: "EUR" } }],
    ["no categories", { categories: [] }],
    ["repeated category", { categories: ["data", "data"] }],
    ["uppercase category", { categories: ["Data"] }],
    ["empty principal", { principal: "  " }],
    ["date with a time", { expires: "2026-12-31T00:00:00Z" }],
    ["impossible date", { expires: "2026-02-30" }],
    ["unknown extra field", { status: "active" }],
  ])("rejects a %s", (_name, change) => {
    expect(MandateInput.safeParse({ ...validMandate, ...change }).success).toBe(false);
  });
});
