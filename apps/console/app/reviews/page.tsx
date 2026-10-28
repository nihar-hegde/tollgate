import Link from "next/link";
import { approveReview, denyReview } from "@/app/reviews/actions";
import { ActionButton } from "@/components/action-button";
import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { getDb } from "@/lib/db";
import { dollars, shortId, timestamp } from "@/lib/format";
import { listReviews, type ReviewStatus } from "@/lib/queries";

export const dynamic = "force-dynamic";

const TONES: Record<ReviewStatus, NonNullable<BadgeProps["tone"]>> = {
  pending: "warn",
  approved: "good",
  denied: "bad",
  expired: "neutral",
};

export default async function ReviewsPage() {
  const now = new Date();
  const reviews = await listReviews(getDb(), now);
  const waiting = reviews.filter((r) => r.status === "pending");
  const resolved = reviews.filter((r) => r.status !== "pending");

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Reviews</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          Purchases above a mandate&apos;s review threshold wait here for a person. Approving runs
          every other check again and issues a new <code>allow</code> that the agent pays with;
          denying closes it. Reviews expire after 24 hours. Saifuro&apos;s API has no way to list
          reviews, so this queue is built from the decision log.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Waiting ({waiting.length})</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {waiting.length === 0 && (
            <p className="text-sm text-muted-foreground">Nothing waits for a decision.</p>
          )}
          {waiting.map(({ review, decision }) => (
            <div
              key={review.id}
              className="flex flex-wrap items-center justify-between gap-4 rounded-md border p-4"
            >
              <div className="grid gap-1">
                <p className="text-sm">
                  <span className="font-mono">{decision.agentId}</span> wants to spend{" "}
                  <strong className="tabular-nums">{dollars(decision.amount)}</strong> on{" "}
                  {decision.category}
                </p>
                <p className="text-xs text-muted-foreground">
                  {decision.reason} · asked {timestamp(decision.issuedAt)} · expires{" "}
                  {timestamp(review.expiresAt)} ·{" "}
                  <Link href={`/decisions/${decision.id}`} className="underline underline-offset-2">
                    {shortId(decision.id)}
                  </Link>
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ActionButton
                  action={approveReview.bind(null, review.id)}
                  label="Approve"
                  pendingLabel="Approving…"
                />
                <ActionButton
                  action={denyReview.bind(null, review.id)}
                  label="Deny"
                  pendingLabel="Denying…"
                  variant="outline"
                  confirmText={`Deny ${dollars(decision.amount)} for ${decision.agentId}?`}
                />
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Resolved</CardTitle>
          <CardDescription>The latest 100 reviews, newest first.</CardDescription>
        </CardHeader>
        <CardContent className="px-2 py-1">
          {resolved.length === 0 ? (
            <p className="px-3 py-4 text-sm text-muted-foreground">No resolved reviews yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Asked (UTC)</TableHead>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Resolved</TableHead>
                  <TableHead>Approval</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {resolved.map(({ review, decision, approval, status }) => (
                  <TableRow key={review.id}>
                    <TableCell className="whitespace-nowrap font-mono text-xs">
                      <Link
                        href={`/decisions/${decision.id}`}
                        className="underline underline-offset-2"
                      >
                        {timestamp(decision.issuedAt)}
                      </Link>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{decision.agentId}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dollars(decision.amount)}
                    </TableCell>
                    <TableCell>
                      <Badge tone={TONES[status]}>{status}</Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {review.resolvedAt ? timestamp(review.resolvedAt) : "—"}
                    </TableCell>
                    <TableCell className="font-mono text-xs">
                      {approval ? (
                        <Link
                          href={`/decisions/${approval}`}
                          className="underline underline-offset-2"
                        >
                          {shortId(approval)}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
