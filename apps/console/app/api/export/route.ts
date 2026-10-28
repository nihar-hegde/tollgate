import { VERDICTS, type Verdict } from "@tollgate/shared";
import { getDb } from "@/lib/db";
import { exportLines } from "@/lib/export";

export const dynamic = "force-dynamic";

// GET /api/export?verdict=&agent= streams the decision log as NDJSON.
export function GET(request: Request): Response {
  const params = new URL(request.url).searchParams;
  const verdict: Verdict | undefined = VERDICTS.find((v) => v === params.get("verdict"));
  const agent = params.get("agent") || undefined;

  const lines = exportLines(getDb(), { verdict, agent });
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await lines.next();
      if (next.done) controller.close();
      else controller.enqueue(encoder.encode(next.value));
    },
  });

  const date = new Date().toISOString().slice(0, 10);
  return new Response(body, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Content-Disposition": `attachment; filename="tollgate-decisions-${date}.ndjson"`,
    },
  });
}
