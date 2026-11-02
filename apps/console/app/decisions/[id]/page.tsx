import Link from "next/link";
import { notFound } from "next/navigation";
import { VerdictBadge } from "@/components/badges";
import { Fact, Facts } from "@/components/facts";
import { Trace } from "@/components/trace";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { jwksUrl } from "@/lib/authorizer";
import { getDb } from "@/lib/db";
import { basescanAddress, basescanTx, dollars, timestamp } from "@/lib/format";
import { getDecision } from "@/lib/queries";
import { checkSignature, decodeToken } from "@/lib/token";

export const dynamic = "force-dynamic";

export default async function DecisionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const detail = await getDecision(getDb(), id, new Date());
  if (!detail) notFound();

  const { decision, delivery, settlement, mandate, review, supersededBy, trace } = detail;
  const token = decodeToken(decision.verdictToken);
  const signature = await checkSignature(decision.verdictToken, jwksUrl());

  return (
    <div className="grid gap-6">
      <div className="grid gap-2">
        <Link href="/decisions" className="text-xs text-muted-foreground hover:text-foreground">
          ← Decisions
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-mono text-lg font-semibold">{decision.id}</h1>
          <VerdictBadge verdict={decision.verdict} />
        </div>
        <p className="text-sm text-muted-foreground">{decision.reason}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Payment trace</CardTitle>
          <CardDescription>
            From the authorizer&apos;s decision to the USDC transfer on Base Sepolia.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Trace steps={trace.steps} />
          {settlement && (
            <a
              href={basescanTx(settlement.txHash)}
              target="_blank"
              rel="noreferrer"
              className="text-sm font-medium underline underline-offset-2"
            >
              View transaction {settlement.txHash} on Basescan ↗
            </a>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Request</CardTitle>
          </CardHeader>
          <CardContent>
            <Facts>
              <Fact label="Agent">{decision.agentId}</Fact>
              <Fact label="Amount">
                {dollars(decision.amount)} ({decision.amount.toString()} base units)
              </Fact>
              <Fact label="Currency">{decision.currency}</Fact>
              <Fact label="Recipient">
                <a
                  href={basescanAddress(decision.recipient)}
                  target="_blank"
                  rel="noreferrer"
                  className="font-mono underline underline-offset-2"
                >
                  {decision.recipient}
                </a>
              </Fact>
              <Fact label="Category">{decision.category}</Fact>
              <Fact label="Protocol">{decision.protocol ?? "—"}</Fact>
              <Fact label="Issued">{timestamp(decision.issuedAt)}</Fact>
              <Fact label="Mode">{decision.mode}</Fact>
              <Fact label="Policy version">{decision.policyVersion}</Fact>
              <Fact label="Verdict nonce">
                <span className="font-mono">{decision.nonce}</span>
              </Fact>
            </Facts>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mandate</CardTitle>
            <CardDescription>
              Mandates are never edited, so this is exactly what the decision was made under.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {mandate ? (
              <Facts>
                <Fact label="Mandate">
                  <span className="font-mono">{mandate.id}</span>
                </Fact>
                <Fact label="Principal">{mandate.principal}</Fact>
                <Fact label="Per transaction">{dollars(mandate.perTransaction)}</Fact>
                <Fact label="Per 30 days">{dollars(mandate.perMonth)}</Fact>
                <Fact label="Categories">{mandate.categories.join(", ")}</Fact>
                <Fact label="Review above">
                  {mandate.reviewAbove === null ? "never" : dollars(mandate.reviewAbove)}
                </Fact>
                <Fact label="Expires">end of {mandate.expires} UTC</Fact>
                <Fact label="Status now">
                  {mandate.status}
                  {mandate.revokedAt && ` (revoked ${timestamp(mandate.revokedAt)})`}
                </Fact>
              </Facts>
            ) : (
              <p className="text-sm text-muted-foreground">
                No mandate applied: {decision.reason}.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      {(decision.supersedesId || review || supersededBy || delivery) && (
        <Card>
          <CardHeader>
            <CardTitle>Related</CardTitle>
          </CardHeader>
          <CardContent>
            <Facts>
              {decision.supersedesId && (
                <Fact label="Approves review">
                  <DecisionLink id={decision.supersedesId} />
                </Fact>
              )}
              {review && (
                <Fact label="Review">
                  {review.status}
                  {review.resolvedAt
                    ? ` at ${timestamp(review.resolvedAt)}`
                    : `, expires ${timestamp(review.expiresAt)}`}
                </Fact>
              )}
              {supersededBy && (
                <Fact label="Approved as">
                  <DecisionLink id={supersededBy} />
                </Fact>
              )}
              {delivery && (
                <>
                  <Fact label="Delivery">
                    <span className="font-mono">{delivery.id}</span> · {delivery.resource} ·{" "}
                    {delivery.status}
                  </Fact>
                  {delivery.payer && (
                    <Fact label="Paid by">
                      <span className="font-mono">{delivery.payer}</span>
                    </Fact>
                  )}
                  {delivery.authorizationNonce && (
                    <Fact label="EIP-3009 nonce">
                      <span className="font-mono">{delivery.authorizationNonce}</span>
                    </Fact>
                  )}
                </>
              )}
            </Facts>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Signed verdict token</CardTitle>
          <CardDescription>
            {signature.valid
              ? `Signature valid: ES256, key ${signature.kid}, checked against the authorizer's published keys.`
              : `Signature could not be confirmed: ${signature.reason}`}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          <pre className="overflow-auto rounded-md border bg-muted/40 p-3 font-mono text-[11px] leading-relaxed">
            {JSON.stringify(token.header, null, 2)}
            {"\n"}
            {JSON.stringify(token.payload, null, 2)}
          </pre>
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground">Raw token</summary>
            <p className="mt-2 break-all font-mono text-[11px]">{decision.verdictToken}</p>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}

function DecisionLink({ id }: { id: string }) {
  return (
    <Link href={`/decisions/${id}`} className="font-mono underline underline-offset-2">
      {id}
    </Link>
  );
}
