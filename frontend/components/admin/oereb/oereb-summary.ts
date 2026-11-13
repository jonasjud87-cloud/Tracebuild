import type { CantonOverview } from "./types";

export interface FlowSummary {
  cantonsTotal: number;
  cantonsActive: number;
  documents: number;
  imported: number;
  pending: number;
  attention: number;
  attentionCantons: { canton: string; count: number }[];
}

export function summarizeCantons(cantons: CantonOverview[]): FlowSummary {
  const out: FlowSummary = {
    cantonsTotal: cantons.length,
    cantonsActive: 0,
    documents: 0,
    imported: 0,
    pending: 0,
    attention: 0,
    attentionCantons: [],
  };
  cantons.forEach((c) => {
    if (c.release.released) out.cantonsActive += 1;
    out.documents += c.total;
    out.imported += c.imported;
    out.pending += c.pending;
    const attention = c.review + c.failed;
    out.attention += attention;
    if (attention > 0) out.attentionCantons.push({ canton: c.canton, count: attention });
  });
  return out;
}
