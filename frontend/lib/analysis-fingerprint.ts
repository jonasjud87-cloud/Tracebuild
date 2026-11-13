import { createHash } from "node:crypto";
import { normTextHash } from "@/lib/norm-hash";

export const ANALYSIS_LOGIC_VERSION = 1;

export interface FingerprintNorm {
  id: string;
  text: string;
  digest?: boolean | null;
}

export interface FingerprintPlace {
  canton?: string | null;
  municipality?: string | null;
  bauzone?: string | null;
}

export function inputFingerprint(norms: FingerprintNorm[], place: FingerprintPlace): string {
  const lines = norms
    .filter((n) => n.id)
    .map((n) => `${n.id}:${normTextHash(n.text)}:${n.digest ? "d" : "f"}`)
    .sort();
  const where = [place.canton ?? "", place.municipality ?? "", place.bauzone ?? ""].map((v) => v.trim().toLowerCase()).join("|");
  return createHash("sha256").update([`v${ANALYSIS_LOGIC_VERSION}`, where, ...lines].join("\n")).digest("hex");
}

export interface ReuseCandidate {
  id: string;
  version_no: number | null;
  created_at: string;
  status: string;
  plan_sha256: string | null;
  input_fingerprint: string | null;
}

export function pickReusable(candidates: ReuseCandidate[], planHash: string, fingerprint: string): ReuseCandidate | null {
  return (
    candidates
      .filter((c) => c.status === "done" && c.plan_sha256 === planHash && c.input_fingerprint === fingerprint)
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0] ?? null
  );
}
