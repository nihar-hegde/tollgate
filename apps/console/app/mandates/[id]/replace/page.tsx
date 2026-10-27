import { fromBaseUnits } from "@tollgate/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { replaceMandate } from "@/app/mandates/actions";
import { MandateForm } from "@/components/mandate-forms";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { getMandate } from "@/lib/queries";

export const dynamic = "force-dynamic";

export default async function ReplaceMandatePage({ params }: PageProps<"/mandates/[id]/replace">) {
  const { id } = await params;
  const mandate = await getMandate(getDb(), id);
  if (!mandate) notFound();

  return (
    <div className="grid max-w-3xl gap-6">
      <Link href="/mandates" className="text-xs text-muted-foreground hover:text-foreground">
        ← Mandates
      </Link>
      <Card>
        <CardHeader>
          <CardTitle>
            Replace <span className="font-mono">{mandate.id}</span>
          </CardTitle>
          <CardDescription>
            Saving revokes this mandate and creates a new one with these terms, in one step.
            Decisions already made keep pointing at the old one.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {mandate.status === "active" ? (
            <MandateForm
              fixedAgent={mandate.agentId}
              action={replaceMandate.bind(null, mandate.id)}
              submitLabel="Replace mandate"
              defaults={{
                principal: mandate.principal,
                perTransaction: fromBaseUnits(mandate.perTransaction),
                perMonth: fromBaseUnits(mandate.perMonth),
                categories: mandate.categories.join(", "),
                reviewAbove: mandate.reviewAbove === null ? "" : fromBaseUnits(mandate.reviewAbove),
                expires: mandate.expires,
              }}
            />
          ) : (
            <p className="text-sm text-muted-foreground">
              This mandate is revoked; create a new one instead.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
