"use server";

import { revalidatePath } from "next/cache";
import { callAuthorizer } from "@/lib/authorizer";
import type { FormState } from "@/lib/form-state";

// The authorizer runs the gates again first; a revoked mandate or spent budget blocks the approval.
export async function approveReview(id: string, _previous: FormState): Promise<FormState> {
  const result = await callAuthorizer<{ decision: string }>(
    "POST",
    `/v1/reviews/${encodeURIComponent(id)}/approve`,
  );
  if (!result.ok) return { error: result.message, message: null };

  refresh();
  return { error: null, message: `Approved as ${result.data.decision}.` };
}

export async function denyReview(id: string, _previous: FormState): Promise<FormState> {
  const result = await callAuthorizer("POST", `/v1/reviews/${encodeURIComponent(id)}/deny`);
  if (!result.ok) return { error: result.message, message: null };

  refresh();
  return { error: null, message: "Denied." };
}

function refresh() {
  for (const path of ["/", "/reviews", "/decisions"]) revalidatePath(path);
}
