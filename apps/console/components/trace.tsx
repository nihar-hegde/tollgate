import type { Step } from "@/lib/trace";
import { cn } from "@/lib/utils";

const MARKS: Record<Step["state"], string> = {
  done: "bg-emerald-600 text-white",
  pending: "bg-amber-100 text-amber-800 ring-1 ring-amber-300",
  failed: "bg-red-600 text-white",
  skipped: "bg-muted text-muted-foreground",
};

const SYMBOLS: Record<Step["state"], string> = {
  done: "✓",
  pending: "…",
  failed: "✕",
  skipped: "–",
};

export function Trace({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid gap-4 md:grid-cols-4">
      {steps.map((step) => (
        <li key={step.name} className="grid min-w-0 content-start gap-2">
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "grid size-6 place-items-center rounded-full text-xs font-semibold",
                MARKS[step.state],
              )}
            >
              {SYMBOLS[step.state]}
            </span>
            <span
              className={cn(
                "text-sm font-medium capitalize",
                step.state === "skipped" && "text-muted-foreground",
              )}
            >
              {step.name}
            </span>
          </div>
          <p className="break-words text-xs text-muted-foreground">
            {step.detail || "not reached"}
          </p>
          {step.at && (
            <p className="font-mono text-[11px] text-muted-foreground">
              {step.at.toISOString().replace("T", " ").slice(0, 19)} UTC
            </p>
          )}
        </li>
      ))}
    </ol>
  );
}
