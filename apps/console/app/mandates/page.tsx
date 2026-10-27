import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AgentForm, MandateForm, RevokeButton } from "@/components/mandate-forms";
import { getDb } from "@/lib/db";
import { dollars, shortId, timestamp } from "@/lib/format";
import { listAgentsWithMandates } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function MandatesPage() {
  const agents = await listAgentsWithMandates(getDb());
  // Only agents without an active mandate can get a new one; the others are replaced instead.
  const withoutMandate = agents
    .filter(({ mandates }) => !mandates.some((m) => m.status === "active"))
    .map(({ agent }) => agent.id);

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Mandates</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
          An agent&apos;s written authority to spend. Mandates are never edited: to change a limit
          you <em>replace</em> it, which revokes the old one and creates a new one that points back
          to it. Every past decision stays explainable by the exact mandate it was made under.
        </p>
      </div>

      {agents.map(({ agent, mandates }) => {
        const active = mandates.find((m) => m.status === "active");
        return (
          <Card key={agent.id}>
            <CardHeader className="flex-row flex-wrap items-center justify-between gap-3">
              <div>
                <CardTitle className="font-mono">{agent.id}</CardTitle>
                <CardDescription>
                  {agent.name} · {agent.status}
                </CardDescription>
              </div>
              {active && (
                <div className="flex items-center gap-2">
                  <Link
                    href={`/mandates/${active.id}/replace`}
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                  >
                    Replace
                  </Link>
                  <RevokeButton mandate={active.id} />
                </div>
              )}
            </CardHeader>
            <CardContent className="px-2 py-1">
              {mandates.length === 0 ? (
                <p className="px-3 py-4 text-sm text-muted-foreground">
                  No mandate yet: every request is deny_no_mandate.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Mandate</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Per call</TableHead>
                      <TableHead className="text-right">Per 30 days</TableHead>
                      <TableHead className="text-right">Review above</TableHead>
                      <TableHead>Categories</TableHead>
                      <TableHead>Valid through</TableHead>
                      <TableHead>History</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {[...mandates].reverse().map((m) => (
                      <TableRow
                        key={m.id}
                        className={m.status === "revoked" ? "text-muted-foreground" : undefined}
                      >
                        <TableCell className="font-mono text-xs">{m.id}</TableCell>
                        <TableCell>
                          <Badge tone={m.status === "active" ? "good" : "neutral"}>
                            {m.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {dollars(m.perTransaction)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {dollars(m.perMonth)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {m.reviewAbove === null ? "never" : dollars(m.reviewAbove)}
                        </TableCell>
                        <TableCell>{m.categories.join(", ")}</TableCell>
                        <TableCell>{m.expires}</TableCell>
                        <TableCell className="text-xs">
                          created {timestamp(m.createdAt)}
                          {m.replacesId && <> · replaces {shortId(m.replacesId)}</>}
                          {m.revokedAt && <> · revoked {timestamp(m.revokedAt)}</>}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        );
      })}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>New mandate</CardTitle>
            <CardDescription>
              For an agent with no active mandate. Amounts are dollars; stored as exact USDC base
              units.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {withoutMandate.length > 0 ? (
              <MandateForm agents={withoutMandate} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Every agent has an active mandate. Replace one, or add an agent.
              </p>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>New agent</CardTitle>
            <CardDescription>
              An id like agt_research_02. It can spend nothing until it has a mandate.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <AgentForm />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
