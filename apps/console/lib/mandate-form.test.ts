import { describe, expect, it } from "vitest";
import { mandateBody } from "./mandate-form";

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const VALID = {
  agent: "agt_research_01",
  principal: " role:research_lead ",
  per_transaction: "5",
  per_month: "50",
  categories: "data, research ,",
  review_above: "2",
  expires: "2026-12-31",
};

describe("the mandate form", () => {
  it("becomes Saifuro's mandate shape, with dollar strings kept as typed", () => {
    expect(mandateBody(form(VALID))).toEqual({
      ok: true,
      body: {
        agent: "agt_research_01",
        principal: "role:research_lead",
        limits: { per_transaction: "5", per_month: "50", currency: "USD" },
        categories: ["data", "research"],
        review_above: "2",
        expires: "2026-12-31",
      },
    });
  });

  it("leaves out review_above when blank, so nothing goes to review", () => {
    const result = mandateBody(form({ ...VALID, review_above: " " }));
    expect(result.ok && "review_above" in result.body).toBe(false);
  });

  it.each([
    ["a float-looking amount", { per_transaction: "5.0000001" }, "more than 6 decimals"],
    [
      "per call above per 30 days",
      { per_transaction: "60" },
      "per_transaction cannot exceed per_month",
    ],
    ["no categories", { categories: " , " }, "categories"],
    ["an uppercase category", { categories: "Data" }, "lowercase"],
    ["a bad date", { expires: "31/12/2026" }, "expires"],
  ])("explains %s", (_case, overrides, message) => {
    const result = mandateBody(form({ ...VALID, ...overrides }));
    expect(result.ok).toBe(false);
    expect(!result.ok && result.message).toContain(message);
  });
});
