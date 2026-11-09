import Link from "next/link";
import type { OverviewLatestAnalysis } from "@/lib/admin-overview/types";
import { Card, focusRing } from "./CardFrame";
import { formatCreated } from "./format";

type GlyphKind = "check" | "spin" | "x" | "stop" | "dash";

const NEUTRAL = "border-[rgba(21,20,20,.1)] bg-[rgba(21,20,20,.05)] text-[#46464a]";

const STATUS: Record<string, { label: string; cls: string; icon: GlyphKind }> = {
  done: { label: "Abgeschlossen", cls: "border-[#65A88A]/25 bg-[#65A88A]/15 text-[#136a40]", icon: "check" },
  running: { label: "Läuft", cls: "border-[#151414] bg-[#151414] text-white", icon: "spin" },
  error: { label: "Fehlgeschlagen", cls: "border-[#D87979]/25 bg-[#D87979]/15 text-[#a3201a]", icon: "x" },
  cancelled: { label: "Abgebrochen", cls: NEUTRAL, icon: "stop" },
};
const UNKNOWN = { label: "Unbekannt", cls: NEUTRAL, icon: "dash" as GlyphKind };

function Glyph({ kind }: { kind: GlyphKind }) {
  const p = { width: 11, height: 11, viewBox: "0 0 12 12", fill: "none", "aria-hidden": true } as const;
  if (kind === "spin")
    return (
      <svg {...p} className="motion-safe:animate-spin">
        <circle cx="6" cy="6" r="4.5" stroke="currentColor" strokeOpacity="0.3" strokeWidth="1.6" />
        <path d="M6 1.5A4.5 4.5 0 0 1 10.5 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  if (kind === "x")
    return (
      <svg {...p}>
        <circle cx="6" cy="6" r="4.8" stroke="currentColor" strokeWidth="1.3" />
        <path d="M4.2 4.2 7.8 7.8M7.8 4.2 4.2 7.8" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
    );
  if (kind === "check")
    return (
      <svg {...p}>
        <circle cx="6" cy="6" r="4.8" stroke="currentColor" strokeWidth="1.3" />
        <path d="M3.9 6.1 5.4 7.6 8.2 4.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  if (kind === "stop")
    return (
      <svg {...p}>
        <circle cx="6" cy="6" r="4.8" stroke="currentColor" strokeWidth="1.3" />
        <rect x="4" y="4" width="4" height="4" rx="0.5" fill="currentColor" />
      </svg>
    );
  return (
    <svg {...p}>
      <circle cx="6" cy="6" r="4.8" stroke="currentColor" strokeWidth="1.3" />
      <path d="M3.8 6h4.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

function Result({ findings }: { findings: number | null }) {
  if (findings === null || findings === undefined)
    return <span className="text-[var(--tba-text-2,#46464a)]"><span aria-hidden="true">–</span><span className="sr-only">Kein Ergebnis</span></span>;
  if (findings === 0) return <span className="text-[var(--tba-text-2,#46464a)]">Keine Hinweise</span>;
  return <span className="inline-flex whitespace-nowrap rounded-full bg-[#D6A45F]/15 px-2.5 py-0.5 text-[13px] font-medium text-[#7a4f00]">{findings} {findings === 1 ? "Hinweis" : "Hinweise"}</span>;
}

export default function LatestAnalysesTable({ rows, className = "" }: { rows: OverviewLatestAnalysis[]; className?: string }) {
  return (
    <Card
      title="Letzte Analysen"
      variant="flat"
      className={className}
      action={
        <Link href="/admin/analyses" className={`rounded text-sm font-medium text-[#6b6153] transition-colors hover:text-[var(--tba-cream,#151414)] ${focusRing}`}>
          Alle Analysen <span aria-hidden="true">→</span>
        </Link>
      }
    >
      {rows.length === 0 ? (
        <p className="py-8 text-center text-sm text-[var(--tba-text-2,#46464a)]">Noch keine Analysen vorhanden.</p>
      ) : (
        <div role="region" aria-label="Letzte Analysen" tabIndex={0} className={`-mx-5 overflow-x-auto tba-scroll-x px-2 ${focusRing}`}>
          <table className="w-full text-left text-sm">
            <thead>
              <tr className="border-b border-[rgba(21,20,20,.1)] bg-[#f6f3ee] text-[13px] uppercase tracking-wide text-[var(--tba-text-2,#46464a)]">
                <th scope="col" className="px-3 py-2.5 font-semibold">Projekt</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Organisation</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                <th scope="col" className="hidden min-[1400px]:table-cell px-3 py-2.5 font-semibold">Erstellt</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Ergebnis</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[rgba(21,20,20,.08)]">
              {rows.map(r => {
                const s = STATUS[r.status] ?? UNKNOWN;
                return (
                  <tr key={r.id} className="tba-row">
                    <th scope="row" className="max-w-[150px] truncate px-3 py-3 text-left font-medium text-[var(--tba-text,#151414)]" title={r.projectName}>{r.projectName}</th>
                    <td className="max-w-[140px] truncate px-3 py-3 text-[var(--tba-text-2,#46464a)]" title={r.orgName}>{r.orgName}</td>
                    <td className="px-3 py-3">
                      <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[13px] font-semibold ${s.cls}`}>
                        <Glyph kind={s.icon} />
                        {s.label}
                      </span>
                    </td>
                    <td className="hidden min-[1400px]:table-cell whitespace-nowrap px-3 py-3 text-[var(--tba-text-2,#46464a)]">{formatCreated(r.createdAt)}</td>
                    <td className="whitespace-nowrap px-3 py-3"><Result findings={r.findings} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
