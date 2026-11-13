"use client";

import Link from "next/link";
import type { NormWatchOverview } from "@/lib/norm-watch/types";
import { STATUS_META, formatDateTime } from "../norms/norm-watch-meta";
import { Card, CardError, CardSkeleton, focusRing, type Resource } from "./CardFrame";

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className={`text-[22px] font-bold tabular-nums ${tone ?? "text-[var(--tba-text,#151414)]"}`}>{value}</p>
      <p className="text-[13px] text-[var(--tba-text-2,#46464a)]">{label}</p>
    </div>
  );
}

function headline(data: NormWatchOverview): { label: string; cls: string } {
  const s = data.summary;
  if (s.updateAvailable > 0) return { label: `${s.updateAvailable} zur Freigabe`, cls: "bg-[#D6A45F]/20 text-[#7a4f00]" };
  if (s.error > 0 || s.missing > 0 || s.stale) return { label: "Prüfen", cls: "bg-[#D87979]/15 text-[#a3201a]" };
  return { label: "Alles aktuell", cls: "bg-[#65A88A]/15 text-[#136a40]" };
}

export default function NormWatchCard({ state, retry }: { state: Resource<NormWatchOverview>; retry: () => void }) {
  if (state.status === "loading") {
    return (
      <Card title="Normen-Aktualität">
        <CardSkeleton rows={2} />
      </Card>
    );
  }
  if (state.status === "error") {
    return (
      <Card title="Normen-Aktualität">
        <CardError message={state.message} onRetry={retry} />
      </Card>
    );
  }

  const data = state.data;
  const s = data.summary;
  const badge = headline(data);
  const attention = data.sources.filter((x) => x.status === "update_available" || x.status === "error" || x.status === "missing").slice(0, 5);

  return (
    <Card
      title="Normen-Aktualität"
      subtitle="Wöchentlicher Abgleich der Bundes- und Kantonsnormen mit den amtlichen Quellen"
      action={
        s.total > 0 ? <span className={`inline-flex rounded-full px-2.5 py-1 text-[13px] font-semibold ${badge.cls}`}>{badge.label}</span> : undefined
      }
    >
      {s.total === 0 ? (
        <p className="text-sm text-[var(--tba-text-2,#46464a)]">Noch keine Quellen eingerichtet.</p>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Quellen" value={String(s.total)} />
            <Stat label="Aktuell" value={String(s.current)} tone="text-[#136a40]" />
            <Stat label="Zur Freigabe" value={String(s.updateAvailable)} tone={s.updateAvailable > 0 ? "text-[#7a4f00]" : undefined} />
            <Stat label="Fehler oder fehlend" value={String(s.error + s.missing)} tone={s.error + s.missing > 0 ? "text-[#a3201a]" : undefined} />
          </div>

          {attention.length > 0 && (
            <ul className="mt-4 divide-y divide-[rgba(21,20,20,.08)]">
              {attention.map((a) => (
                <li key={a.id} className="flex items-center gap-3 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-[var(--tba-text,#151414)]">{a.label}</p>
                    <p className="truncate text-[13px] text-[var(--tba-text-2,#46464a)]">
                      {a.status === "error" ? a.lastError ?? "Fehler beim Abgleich" : a.status === "missing" ? "Keiner Norm zugeordnet" : a.remoteLabel ?? "Neue Fassung"}
                    </p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-[13px] font-medium ${STATUS_META[a.status].pill}`}>
                    {STATUS_META[a.status].label}
                  </span>
                </li>
              ))}
            </ul>
          )}

          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-[13px] text-[var(--tba-text-2,#46464a)]">
            <span>
              {s.lastCheckedAt
                ? `Zuletzt geprüft: ${formatDateTime(s.lastCheckedAt)}${s.stale ? " (überfällig)" : ""}`
                : "Der Abgleich ist noch nie gelaufen."}
            </span>
            <Link href="/admin/norms#norm-watch" className={`font-semibold text-[var(--tba-text,#151414)] underline-offset-2 hover:underline ${focusRing}`}>
              Zum Normabgleich
            </Link>
          </div>
        </>
      )}
    </Card>
  );
}
