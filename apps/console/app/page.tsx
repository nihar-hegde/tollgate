import Link from "next/link";
import { VerdictBadge } from "@/components/badges";
import { Badge } from "@/components/ui/badge";
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
import { basescanTx, dollars, shortHex, shortId, timestamp } from "@/lib/format";
import { reconciliation, spendByAgent, verdictCounts } from "@/lib/overview";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;

export default async function OverviewPage() {
  const db = getDb();
  const now = new Date();
  const [verdicts, spend, chain] = await Promise.all([
    verdictCounts(db, new Date(now.getTime() - 30 * DAY_MS)),
    spendByAgent(db, now),
    reconciliation(db, now),
  ]);
  const totalDecisions = verdicts.reduce((sum, v) => sum + v.count, 0);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Overview</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          What the agents asked for, what was actually paid on Base Sepolia, and what doesn&apos;t
          add up.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Spend by agent</CardTitle>
            <CardDescription>
              Settled payments. The authorizer also counts approvals still usable (up to 6 minutes)
              toward the limit.
            </CardDescription>
          </CardHeader>
          <CardContent className="px-2 py-1">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Agent</TableHead>
                  <TableHead className="text-right">Today</TableHead>
                  <TableHead className="text-right">30 days</TableHead>
                  <TableHead>Of 30-day limit</TableHead>
                  <TableHead className="text-right">Reviews</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {spend.map((row) => (
                  <TableRow key={row.agent}>
                    <TableCell className="font-mono text-xs">
                      {row.agent}
                      {row.status === "disabled" && (
                        <span className="ml-2 text-muted-foreground">(disabled)</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{dollars(row.today)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {dollars(row.last30Days)}
                    </TableCell>
                    <TableCell>
                      {row.perMonth === null ? (
                        <span className="text-xs text-muted-foreground">no active mandate</span>
                      ) : (
                        <Usage used={row.last30Days} limit={row.perMonth} />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {row.waitingReviews > 0 ? (
                        <Link href="/reviews">
                          <Badge tone="warn">{row.waitingReviews} waiting</Badge>
                        </Link>
                      ) : (
                        <span className="text-xs text-muted-foreground">none</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Decisions, last 30 days</CardTitle>
            <CardDescription>{totalDecisions} in total</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-2">
            {verdicts.map(({ verdict, count }) => (
              <Link
                key={verdict}
                href={`/decisions?verdict=${verdict}`}
                className="flex items-center justify-between rounded-md px-2 py-1 hover:bg-muted"
              >
                <VerdictBadge verdict={verdict} />
                <span className="tabular-nums text-sm">{count}</span>
              </Link>
            ))}
            {verdicts.length === 0 && (
              <p className="text-sm text-muted-foreground">No decisions yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Reconciliation with the chain</CardTitle>
          <CardDescription>
            From the indexer: USDC transfers to the seller on Base Sepolia, matched to the
            deliveries the seller recorded.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          {chain === null ? (
            <p className="text-sm text-muted-foreground">
              Set SELLER_ADDRESS to see which payments the chain confirms.
            </p>
          ) : (
            <>
              <div className="grid gap-3 sm:grid-cols-4">
                <Count label="Confirmed" value={chain.confirmed.length} tone="good" />
                <Count label="Paid without a decision" value={chain.unexpected.length} tone="bad" />
                <Count label="Allowed, not settled" value={chain.unconfirmed.length} tone="warn" />
                <Count label="Mismatched" value={chain.mismatched.length} tone="bad" />
              </div>
              <Exceptions
                title="Paid without a decision"
                hint="USDC arrived at the seller with no accepted verdict behind it: an agent paid without asking."
                rows={chain.unexpected.map((s) => ({
                  key: `${s.txHash}:${s.logIndex}`,
                  what: `${dollars(s.value)} from ${shortHex(s.fromAddress)} in block ${s.blockNumber}`,
                  tx: s.txHash,
                }))}
              />
              <Exceptions
                title="Allowed, not settled"
                hint="The seller accepted a verdict, but no transfer reached the chain within 10 minutes."
                rows={chain.unconfirmed.map((d) => ({
                  key: d.id,
                  what: `${dollars(d.amount)} for ${shortId(d.decisionId)} · ${d.status} since ${timestamp(d.createdAt)}`,
                  decision: d.decisionId,
                }))}
              />
              <Exceptions
                title="Mismatched"
                hint="On-chain, but disagreeing with the seller's record."
                rows={chain.mismatched.map(({ delivery, settlement, problem }) => ({
                  key: delivery.id,
                  what: `${shortId(delivery.decisionId)}: ${problem}`,
                  decision: delivery.decisionId,
                  tx: settlement.txHash,
                }))}
              />
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Usage({ used, limit }: { used: bigint; limit: bigint }) {
  // Integer basis points, so no float touches the amounts.
  const basisPoints = Number((used * 10_000n) / limit);
  return (
    <div className="flex items-center gap-2">
      <div className="h-1.5 w-24 overflow-hidden rounded-full bg-muted">
        <div
          className="h-full bg-primary"
          style={{ width: `${Math.min(basisPoints / 100, 100)}%` }}
        />
      </div>
      <span className="text-xs tabular-nums text-muted-foreground">
        {(basisPoints / 100).toFixed(1)}% of {dollars(limit)}
      </span>
    </div>
  );
}

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "bad" | "warn";
}) {
  return (
    <div className="rounded-md border p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 flex items-center gap-2 text-2xl font-semibold tabular-nums">
        {value}
        {value > 0 && tone !== "good" && <Badge tone={tone}>needs a look</Badge>}
      </p>
    </div>
  );
}

type ExceptionRow = { key: string; what: string; decision?: string; tx?: string };

function Exceptions({ title, hint, rows }: { title: string; hint: string; rows: ExceptionRow[] }) {
  if (rows.length === 0) return null;
  return (
    <div className="grid gap-2">
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{hint}</p>
      <ul className="grid gap-1 text-sm">
        {rows.map((row) => (
          <li key={row.key} className="flex flex-wrap gap-3">
            <span>{row.what}</span>
            {row.decision && (
              <Link
                href={`/decisions/${row.decision}`}
                className="text-xs underline underline-offset-2"
              >
                decision
              </Link>
            )}
            {row.tx && (
              <a
                href={basescanTx(row.tx)}
                target="_blank"
                rel="noreferrer"
                className="text-xs underline underline-offset-2"
              >
                Basescan ↗
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
