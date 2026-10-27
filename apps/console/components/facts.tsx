import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// A label/value list, used wherever a record is shown field by field.
export function Facts({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[8.5rem_1fr] gap-x-4 gap-y-2 text-sm", className)}>
      {children}
    </dl>
  );
}

export function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  );
}
