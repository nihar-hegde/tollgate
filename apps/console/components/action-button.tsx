"use client";

import { useActionState } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { EMPTY_FORM, type FormState } from "@/lib/form-state";

// One button that runs a bound server action, optionally after a confirmation, and shows the outcome.
export function ActionButton({
  action,
  label,
  pendingLabel,
  confirmText,
  variant,
}: {
  action: (previous: FormState) => Promise<FormState>;
  label: string;
  pendingLabel: string;
  confirmText?: string;
  variant?: ButtonProps["variant"];
}) {
  const [state, formAction, pending] = useActionState(action, EMPTY_FORM);
  return (
    <form
      action={formAction}
      onSubmit={(event) => {
        if (confirmText && !confirm(confirmText)) event.preventDefault();
      }}
      className="flex flex-wrap items-center gap-2"
    >
      <Button type="submit" variant={variant} size="sm" disabled={pending}>
        {pending ? pendingLabel : label}
      </Button>
      {state.error && <span className="text-xs text-destructive">{state.error}</span>}
      {state.message && <span className="text-xs text-emerald-700">{state.message}</span>}
    </form>
  );
}
