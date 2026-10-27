// Turns the mandate form into the authorizer's request body: Saifuro's mandate shape, dollar strings.

import { MandateInput } from "@tollgate/shared";
import { z } from "zod";

export type MandateBody = {
  agent: string;
  principal: string;
  limits: { per_transaction: string; per_month: string; currency: "USD" };
  categories: string[];
  review_above?: string;
  expires: string;
};

// A text field's trimmed value; missing fields and file inputs read as "".
export function field(form: FormData, name: string): string {
  const value = form.get(name);
  return typeof value === "string" ? value.trim() : "";
}

export function mandateBody(
  form: FormData,
): { ok: true; body: MandateBody } | { ok: false; message: string } {
  const text = (name: string) => field(form, name);
  const reviewAbove = text("review_above");

  const body: MandateBody = {
    agent: text("agent"),
    principal: text("principal"),
    limits: {
      per_transaction: text("per_transaction"),
      per_month: text("per_month"),
      currency: "USD",
    },
    categories: text("categories")
      .split(",")
      .map((c) => c.trim())
      .filter(Boolean),
    ...(reviewAbove !== "" && { review_above: reviewAbove }),
    expires: text("expires"),
  };

  // The authorizer validates too; checking here gives the operator the message without a round trip.
  const parsed = MandateInput.safeParse(body);
  if (!parsed.success) return { ok: false, message: z.prettifyError(parsed.error) };
  return { ok: true, body };
}
