"use client";

import type { DigestRow, NormDigests } from "./useNormDigests";

const STATE: Record<DigestRow["state"], { label: string; cls: string }> = {
  ok: { label: "Prüfauszug aktiv", cls: "bg-[#e4f3ea] text-[#136a40]" },
  failed: { label: "Prüfauszug fehlgeschlagen", cls: "bg-[#fde7e5] text-[#a3201a]" },
  missing: { label: "Prüfauszug fehlt", cls: "bg-[#fff1d6] text-[#7a4f00]" },
  outdated: { label: "Prüfauszug veraltet", cls: "bg-[#fff1d6] text-[#7a4f00]" },
};

const BTN = "rounded-lg border border-[#8c8b8e] bg-white px-3 py-1 text-sm font-medium text-[#151414] transition-colors hover:bg-[#f6f3ee] disabled:opacity-50";

function chars(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

interface Props {
  row: DigestRow;
  digests: NormDigests;
}

export default function DigestInline({ row, digests }: Props) {
  const state = STATE[row.state];
  const share = row.digestChars ? Math.round((row.digestChars / row.sourceChars) * 100) : null;
  const open = digests.viewing === row.normId;
  return (
    <div className="mt-2 rounded-xl bg-[#f6f3ee] px-3 py-2.5">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] font-medium ${state.cls}`}>{state.label}</span>
        <span className="text-sm tabular-nums text-[#46464a]">
          {chars(row.sourceChars)} Zeichen{row.digestChars ? ` → ${chars(row.digestChars)} (${share} %)` : ""}
        </span>
        <span className="ml-auto flex flex-wrap gap-2">
          {(row.state === "ok" || row.digestChars !== null) && (
            <button type="button" onClick={() => void digests.toggleView(row.normId)} className={BTN} aria-expanded={open}>
              {open ? "Auszug verbergen" : "Auszug ansehen"}
            </button>
          )}
          <button type="button" disabled={digests.busy} onClick={() => void digests.run(row.state !== "missing", row.normId)} className={BTN}>
            {row.state === "missing" ? "Erstellen" : "Neu erstellen"}
          </button>
        </span>
      </div>
      {row.note && <p className="mt-1.5 text-[13px] text-[#5f5f64]" style={{ overflowWrap: "anywhere" }}>{row.note}</p>}
      {open && (
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap rounded-lg bg-white p-3 text-[13px] leading-relaxed text-[#151414]">
          {digests.viewText ?? "Wird geladen…"}
        </pre>
      )}
    </div>
  );
}
