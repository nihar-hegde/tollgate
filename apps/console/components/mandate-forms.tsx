"use client";

import { useActionState } from "react";
import { createAgent, createMandate, revokeMandate, type FormState } from "@/app/mandates/actions";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMPTY: FormState = { error: null, message: null };

type FormAction = (previous: FormState, form: FormData) => Promise<FormState>;

export type MandateDefaults = {
  agent?: string;
  principal?: string;
  perTransaction?: string;
  perMonth?: string;
  categories?: string;
  reviewAbove?: string;
  expires?: string;
};

// Creates a mandate for one of `agents`, or, given `fixedAgent` and a bound `action`, replaces one.
export function MandateForm({
  agents = [],
  fixedAgent,
  defaults = {},
  action = createMandate,
  submitLabel = "Create mandate",
}: {
  agents?: string[];
  fixedAgent?: string;
  defaults?: MandateDefaults;
  action?: FormAction;
  submitLabel?: string;
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY);

  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Agent" htmlFor="agent">
          {fixedAgent ? (
            <>
              <Input id="agent" value={fixedAgent} disabled />
              <input type="hidden" name="agent" value={fixedAgent} />
            </>
          ) : (
            <Select id="agent" name="agent" defaultValue={defaults.agent} required>
              {agents.map((agent) => (
                <option key={agent} value={agent}>
                  {agent}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Principal (who granted it)" htmlFor="principal">
          <Input
            id="principal"
            name="principal"
            defaultValue={defaults.principal ?? "role:research_lead"}
            required
          />
        </Field>
        <Field label="Per transaction ($)" htmlFor="per_transaction">
          <Input
            id="per_transaction"
            name="per_transaction"
            inputMode="decimal"
            defaultValue={defaults.perTransaction ?? "5"}
            required
          />
        </Field>
        <Field label="Per 30 days ($)" htmlFor="per_month">
          <Input
            id="per_month"
            name="per_month"
            inputMode="decimal"
            defaultValue={defaults.perMonth ?? "50"}
            required
          />
        </Field>
        <Field label="Categories (comma-separated)" htmlFor="categories">
          <Input
            id="categories"
            name="categories"
            defaultValue={defaults.categories ?? "data"}
            required
          />
        </Field>
        <Field label="Review above ($, blank for never)" htmlFor="review_above">
          <Input
            id="review_above"
            name="review_above"
            inputMode="decimal"
            defaultValue={defaults.reviewAbove ?? "2"}
          />
        </Field>
        <Field label="Valid through (UTC)" htmlFor="expires">
          <Input
            id="expires"
            name="expires"
            type="date"
            defaultValue={defaults.expires ?? "2026-12-31"}
            required
          />
        </Field>
      </div>
      <FormFooter state={state} pending={pending} label={submitLabel} />
    </form>
  );
}

export function AgentForm() {
  const [state, formAction, pending] = useActionState(createAgent, EMPTY);
  return (
    <form action={formAction} className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Agent id" htmlFor="agent-id">
          <Input id="agent-id" name="id" placeholder="agt_research_02" required />
        </Field>
        <Field label="Name" htmlFor="agent-name">
          <Input id="agent-name" name="name" placeholder="Research agent" required />
        </Field>
      </div>
      <FormFooter state={state} pending={pending} label="Create agent" />
    </form>
  );
}

export function RevokeButton({ mandate }: { mandate: string }) {
  const [state, formAction, pending] = useActionState(revokeMandate.bind(null, mandate), EMPTY);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (
          !confirm(`Revoke ${mandate}? The agent's next request is denied. This can't be undone.`)
        ) {
          event.preventDefault();
        }
      }}
      className="flex items-center gap-2"
    >
      <Button type="submit" variant="destructive" size="sm" disabled={pending}>
        {pending ? "Revoking…" : "Revoke"}
      </Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
    </form>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
    </div>
  );
}

function FormFooter({
  state,
  pending,
  label,
}: {
  state: FormState;
  pending: boolean;
  label: string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button type="submit" disabled={pending}>
        {pending ? "Saving…" : label}
      </Button>
      {state.error && <p className="whitespace-pre-line text-sm text-destructive">{state.error}</p>}
      {state.message && <p className="text-sm text-emerald-700">{state.message}</p>}
    </div>
  );
}
