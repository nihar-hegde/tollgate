"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { callAuthorizer } from "@/lib/authorizer";
import type { FormState } from "@/lib/form-state";
import { field, mandateBody } from "@/lib/mandate-form";

export async function createAgent(_previous: FormState, form: FormData): Promise<FormState> {
  const id = field(form, "id");
  const name = field(form, "name");
  const result = await callAuthorizer("POST", "/v1/agents", { id, name });
  if (!result.ok) return { error: result.message, message: null };

  revalidatePath("/mandates");
  return { error: null, message: `Agent ${id} created.` };
}

export async function createMandate(_previous: FormState, form: FormData): Promise<FormState> {
  const parsed = mandateBody(form);
  if (!parsed.ok) return { error: parsed.message, message: null };

  const result = await callAuthorizer<{ mandate: string }>("POST", "/v1/mandates", parsed.body);
  if (!result.ok) return { error: result.message, message: null };

  revalidatePath("/mandates");
  return { error: null, message: `Mandate ${result.data.mandate} created.` };
}

// Revokes the old mandate and creates its successor in one step, on the authorizer's side.
export async function replaceMandate(
  id: string,
  _previous: FormState,
  form: FormData,
): Promise<FormState> {
  const parsed = mandateBody(form);
  if (!parsed.ok) return { error: parsed.message, message: null };

  const result = await callAuthorizer(
    "POST",
    `/v1/mandates/${encodeURIComponent(id)}/replace`,
    parsed.body,
  );
  if (!result.ok) return { error: result.message, message: null };

  revalidatePath("/mandates");
  redirect("/mandates");
}

export async function revokeMandate(id: string, _previous: FormState): Promise<FormState> {
  const result = await callAuthorizer("POST", `/v1/mandates/${encodeURIComponent(id)}/revoke`);
  if (!result.ok) return { error: result.message, message: null };

  revalidatePath("/mandates");
  return { error: null, message: `Mandate ${id} revoked.` };
}
