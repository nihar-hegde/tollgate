// Server → client: plain strings only, so bigints and dates never cross into the browser.

import { fromBaseUnits } from "@tollgate/shared";
import type { listDecisions } from "./queries";
import { decodeToken } from "./token";
import type { Stage } from "./trace";

export type DecisionRow = {
  id: string;
  issuedAt: string;
  agent: string;
  amount: string;
  verdict: string;
  reason: string;
  mandate: string | null;
  recipient: string;
  category: string;
  mode: string;
  stage: Stage;
  txHash: string | null;
  token: { header: string; payload: string };
};

export function decisionRow({
  decision,
  delivery,
  trace,
}: Awaited<ReturnType<typeof listDecisions>>[number]): DecisionRow {
  const { header, payload } = decodeToken(decision.verdictToken);
  return {
    id: decision.id,
    issuedAt: decision.issuedAt.toISOString(),
    agent: decision.agentId,
    amount: fromBaseUnits(decision.amount),
    verdict: decision.verdict,
    reason: decision.reason,
    mandate: decision.mandateId,
    recipient: decision.recipient,
    category: decision.category,
    mode: decision.mode,
    stage: trace.stage,
    txHash: delivery?.txHash ?? null,
    token: { header: JSON.stringify(header, null, 2), payload: JSON.stringify(payload, null, 2) },
  };
}
