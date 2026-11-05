/** Adapter: Modellaufrufe über die bestehende Engine. Prompt-Kapselung bleibt dort. */
import {
  ANALYSIS_MODEL,
  analyseOneNorm,
  computeCost,
  consolidateItems,
  type NormInput,
} from "@/lib/analysis-engine";
import type { ModelCaller } from "./ports";
import { toNormPart } from "./plan";

export function createAnthropicModel(): ModelCaller {
  return {
    model: ANALYSIS_MODEL,
    callPart(req) {
      return analyseOneNorm(
        toNormPart(req.unit, req.boundary),
        req.unit.index,
        req.unit.total,
        req.system,
        req.files,
        req.referenceText,
        req.inReference,
        req.deadlineAt,
        req.onPrefillDone,
        req.effort ?? undefined,
        req.signal,
      );
    },
    consolidate(req) {
      // layerOf braucht nur id und layer; der Volltext ist bewusst nicht im Snapshot.
      const norms: NormInput[] = req.norms.map((n) => ({ ...n, text: "" }));
      return consolidateItems(req.items, norms, req.deadlineAt, req.signal, { callMs: req.callMs, maxTokens: req.maxTokens });
    },
    cost: (usage) => computeCost(usage),
  };
}
