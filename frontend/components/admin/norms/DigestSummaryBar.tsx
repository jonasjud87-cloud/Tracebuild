"use client";

import { summarizeDigests } from "./library-filter";
import type { NormDigests } from "./useNormDigests";

const BTN = "rounded-lg border border-[#8c8b8e] bg-white px-3 py-1.5 text-sm font-medium text-[#151414] transition-colors hover:bg-[#f6f3ee] disabled:opacity-50";

export default function DigestSummaryBar({ digests }: { digests: NormDigests }) {
  if (digests.error) return <p className="text-sm text-[#a3201a]">{digests.error}</p>;
  if (!digests.loaded) return null;
  if (!digests.available) {
    return <p className="rounded-2xl border border-[rgba(21,20,20,0.08)] bg-white px-4 py-3 text-sm text-[#46464a]">Prüfauszüge sind noch nicht eingerichtet: Migration 20261113000004 fehlt.</p>;
  }
  if (!digests.rows.length) return null;

  const summary = summarizeDigests(digests.rows.map((r) => r.state));

  return (
    <section aria-label="Prüfauszüge" className="rounded-2xl border border-[rgba(21,20,20,0.08)] bg-white px-4 py-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-[#151414]">
          <span className="font-bold">Prüfauszüge:</span> {summary.active} von {summary.total} aktiv
          {summary.todo > 0 ? `, ${summary.todo} offen` : ""}
        </p>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={digests.busy || summary.todo === 0} onClick={() => void digests.run(false)} className={BTN}>
            {digests.busy ? "Wird erstellt…" : summary.todo > 0 ? `Fehlende erstellen (${summary.todo})` : "Alle aktuell"}
          </button>
          <button type="button" disabled={digests.busy} onClick={() => void digests.run(true)} className={BTN}>
            Alle neu erstellen
          </button>
        </div>
      </div>
      {digests.message && <p role="status" className="mt-2 text-sm text-[#46464a]">{digests.message}</p>}
      <details className="mt-2">
        <summary className="cursor-pointer text-sm font-medium text-[#46464a] hover:text-[#151414]">Wie funktionieren Prüfauszüge?</summary>
        <p className="mt-2 max-w-3xl text-sm leading-relaxed text-[#5f5f64]">
          Lange Gesetze werden einmal pro Fassung auf die Bestimmungen gekürzt, die sich an einem Plan prüfen lassen, im Wortlaut des Gesetzes. Die Analyse verwendet dann
          diesen Auszug statt des ganzen Texts und wird günstiger. Auszüge von Bundesgesetzen werden automatisch aktiv, bei einer neuen Fassung entstehen sie von selbst.
          Bei kantonalen Gesetzen erstellst du den ersten Auszug von Hand und liest ihn zuerst durch. Fehlt ein Auszug oder besteht seine Prüfung nicht, gilt weiter der volle
          Text. «Fehlende erstellen» prüft gespeicherte Auszüge zuerst ohne Kosten erneut. «Neu erstellen» bezahlt einen neuen Versuch und ersetzt nie einen funktionierenden
          Auszug.
        </p>
      </details>
    </section>
  );
}
