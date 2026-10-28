import { VERDICTS, type Verdict } from "@tollgate/shared";
import { DecisionsTable } from "@/components/decisions-table";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/input";
import { getDb } from "@/lib/db";
import { listDecisions } from "@/lib/queries";
import { decisionRow } from "@/lib/views";

export const dynamic = "force-dynamic";

export default async function DecisionsPage({ searchParams }: PageProps<"/decisions">) {
  const params = await searchParams;
  const verdict: Verdict | undefined = VERDICTS.find((v) => v === params.verdict);
  const agent = typeof params.agent === "string" && params.agent !== "" ? params.agent : undefined;

  const rows = (await listDecisions(getDb(), { verdict, agent }, new Date())).map(decisionRow);
  const exportQuery = new URLSearchParams({
    ...(verdict && { verdict }),
    ...(agent && { agent }),
  }).toString();

  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Decisions</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every authorization the agents asked for, newest first. The log is append-only: nothing
          here is ever edited or deleted.
        </p>
      </div>

      <Card>
        <CardHeader className="flex-row flex-wrap items-end justify-between gap-4">
          <div>
            <CardTitle>Log</CardTitle>
            <CardDescription>
              {rows.length} shown{rows.length === 200 ? " (latest 200)" : ""}. Expand a row for the
              request and the decoded verdict token.
            </CardDescription>
          </div>
          <form className="flex items-end gap-2">
            <Select
              name="verdict"
              defaultValue={verdict ?? ""}
              aria-label="Verdict"
              className="w-44"
            >
              <option value="">All verdicts</option>
              {VERDICTS.map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </Select>
            <Input
              name="agent"
              defaultValue={agent ?? ""}
              placeholder="agt_…"
              aria-label="Agent"
              className="w-48"
            />
            <Button type="submit" variant="outline">
              Filter
            </Button>
            <a
              href={`/api/export?${exportQuery}`}
              className={buttonVariants({ variant: "outline" })}
              download
            >
              Export NDJSON
            </a>
          </form>
        </CardHeader>
        <CardContent className="px-2 py-1">
          <DecisionsTable rows={rows} />
        </CardContent>
      </Card>
    </div>
  );
}
