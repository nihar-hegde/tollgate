import { Badge, type BadgeProps } from "@/components/ui/badge";
import type { Stage } from "@/lib/trace";

type Tone = NonNullable<BadgeProps["tone"]>;

export function VerdictBadge({ verdict }: { verdict: string }) {
  const tone: Tone = verdict === "allow" ? "good" : verdict === "review" ? "warn" : "bad";
  return <Badge tone={tone}>{verdict}</Badge>;
}

const STAGE_TONES: Record<Stage, Tone> = {
  confirmed: "good",
  settled: "info",
  verified: "info",
  approved: "info",
  authorized: "neutral",
  unused: "neutral",
  "awaiting review": "warn",
  "review denied": "neutral",
  "review expired": "neutral",
  denied: "bad",
  "payment failed": "bad",
};

export function StageBadge({ stage }: { stage: Stage }) {
  return <Badge tone={STAGE_TONES[stage]}>{stage}</Badge>;
}
