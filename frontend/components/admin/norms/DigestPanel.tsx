"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";

interface DigestRow {
  normId: string;
  title: string;
  sourceChars: number;
  state: "ok" | "failed" | "missing" | "outdated";
  digestChars: number | null;
  note: string | null;
  costUsd: number | null;
  createdAt: string | null;
}

interface Overview {
  available: boolean;
  rows: DigestRow[];
}

interface RunSummary {
  created: number;
  failed: number;
  skipped: number;
  costUsd: number;
}

const STATE: Record<DigestRow["state"], { label: string; cls: string }> = {
  ok: { label: "Aktiv", cls: "bg-[#e4f3ea] text-[#136a40]" },
  failed: { label: "Fehlgeschlagen", cls: "bg-[#fde7e5] text-[#a3201a]" },
  missing: { label: "Fehlt", cls: "bg-[#fff1d6] text-[#7a4f00]" },
  outdated: { label: "Veraltet", cls: "bg-[#fff1d6] text-[#7a4f00]" },
};

const BTN = "rounded-lg border border-[#8c8b8e] bg-white px-3 py-1.5 text-sm font-medium text-[#151414] transition-colors hover:bg-[#f6f3ee] disabled:opacity-50";

function chars(n: number): string {
  return n >= 1000 ? `${Math.round(n / 1000)}k` : String(n);
}

export default function DigestPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.get<Overview>("/admin/norm-digests"));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Prüfauszüge konnten nicht geladen werden.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function run(force: boolean, normId?: string) {
    if (!data) return;
    const targets = normId ? data.rows.filter((r) => r.normId === normId) : data.rows.filter((r) => force || r.state !== "ok");
    setBusy(true);
    setMessage(null);
    const total: RunSummary = { created: 0, failed: 0, skipped: 0, costUsd: 0 };
    try {
      for (let i = 0; i < targets.length; i++) {
        const row = targets[i];
        setMessage(`Erstelle ${i + 1} von ${targets.length}: ${row.title}`);
        const result = await api.post<RunSummary>("/admin/norm-digests", { force, normId: row.normId });
        total.created += result.created;
        total.failed += result.failed;
        total.skipped += result.skipped;
        total.costUsd += result.costUsd;
        await load();
      }
      setMessage(`${total.created} erstellt, ${total.failed} fehlgeschlagen, ${total.skipped} übersprungen. Kosten ${total.costUsd.toFixed(2)} USD.`);
    } catch (e) {
      setMessage(`${e instanceof Error ? e.message : "Erstellung fehlgeschlagen."} Bisher: ${total.created} erstellt, ${total.failed} fehlgeschlagen, Kosten ${total.costUsd.toFixed(2)} USD.`);
    } finally {
      setBusy(false);
    }
  }

  if (error) return <p className="text-sm text-[#a3201a]">{error}</p>;
  if (!data) return null;
  if (!data.available) {
    return <p className="rounded-2xl border border-[rgba(21,20,20,0.08)] bg-white px-4 py-3 text-sm text-[#46464a]">Prüfauszüge sind noch nicht eingerichtet: Migration 20261113000004 fehlt.</p>;
  }
  if (!data.rows.length) return null;

  const todo = data.rows.filter((r) => r.state !== "ok").length;

  return (
    <section aria-label="Prüfauszüge" className="rounded-2xl border border-[rgba(21,20,20,0.08)] bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-3xl">
          <h2 className="text-base font-bold text-[#151414]">Prüfauszüge der Bundesnormen</h2>
          <p className="mt-1 text-sm text-[#5f5f64]">
            Lange Bundesnormen werden einmal pro Fassung auf die Bestimmungen gekürzt, die sich an einem Plan prüfen lassen, im Wortlaut des Gesetzes. Die Analyse
            verwendet dann diesen Auszug statt des ganzen Texts und wird dadurch günstiger. Neue Auszüge werden automatisch aktiv, bei einer neuen Fassung entstehen
            sie von selbst. Fehlt ein Auszug oder besteht seine Prüfung nicht, gilt weiter der volle Text. «Fehlende erstellen» prüft gespeicherte Auszüge zuerst ohne Kosten erneut. «Neu erstellen» bezahlt einen neuen Versuch und ersetzt nie einen funktionierenden Auszug.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy || todo === 0} onClick={() => void run(false)} className={BTN}>
            {busy ? "Wird erstellt…" : todo > 0 ? `Fehlende erstellen (${todo})` : "Alle aktuell"}
          </button>
          <button type="button" disabled={busy} onClick={() => void run(true)} className={BTN}>
            Alle neu erstellen
          </button>
        </div>
      </div>
      {message && <p role="status" className="mt-3 text-sm text-[#46464a]">{message}</p>}
      <ul className="mt-3 divide-y divide-[rgba(21,20,20,0.08)]">
        {data.rows.map((r) => {
          const state = STATE[r.state];
          const share = r.digestChars ? Math.round((r.digestChars / r.sourceChars) * 100) : null;
          return (
            <li key={r.normId} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2.5">
              <span className={`whitespace-nowrap rounded-full px-2 py-0.5 text-[13px] font-medium ${state.cls}`}>{state.label}</span>
              <span className="min-w-0 flex-1 text-sm font-medium text-[#151414]" style={{ overflowWrap: "anywhere" }}>{r.title}</span>
              <span className="text-sm tabular-nums text-[#5f5f64]">
                {chars(r.sourceChars)} Zeichen{r.digestChars ? ` → ${chars(r.digestChars)} (${share} %)` : ""}
              </span>
              <button type="button" disabled={busy} onClick={() => void run(true, r.normId)} className={BTN}>
                Neu erstellen
              </button>
              {r.note && <span className="w-full text-[13px] text-[#5f5f64]" style={{ overflowWrap: "anywhere" }}>{r.note}</span>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
