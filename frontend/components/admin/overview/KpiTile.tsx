import type { ReactNode } from "react";

interface Props {
  label: string;
  value: string;
  icon: ReactNode;
  changePct?: number | null;
  hideTrend?: boolean;
  lowerIsBetter?: boolean;
}

function Trend({ pct, lowerIsBetter }: { pct: number | null | undefined; lowerIsBetter?: boolean }) {
  const r = pct === null || pct === undefined || !Number.isFinite(pct) ? null : Math.round(pct);
  if (r === null) {
    return (
      <span className="text-sm font-semibold text-[var(--tba-text-2,#46464a)]">
        <span aria-hidden="true">–</span>
        <span className="sr-only">Kein Vergleichswert</span>
      </span>
    );
  }
  if (r === 0) {
    return <span className="text-sm font-semibold text-[var(--tba-text-2,#46464a)]">0%<span className="sr-only"> unverändert</span></span>;
  }
  const up = r > 0;
  const good = lowerIsBetter ? !up : up;
  const color = good ? "text-[#136a40]" : "text-[#a3201a]";
  const text = `${up ? "+" : "−"}${Math.abs(r)}%`;
  return (
    <span className={`inline-flex items-center gap-0.5 text-sm font-semibold ${color}`}>
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        {up ? (
          <path d="M6 10V2M2.5 5.5 6 2l3.5 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        ) : (
          <path d="M6 2v8M2.5 6.5 6 10l3.5-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
        )}
      </svg>
      <span aria-hidden="true">{text}</span>
      <span className="sr-only">{`${up ? "Anstieg" : "Rückgang"} um ${Math.abs(r)} Prozent gegenüber Vorperiode`}</span>
    </span>
  );
}

export default function KpiTile({ label, value, icon, changePct, hideTrend, lowerIsBetter }: Props) {
  return (
    <div className="tba-glass tba-card flex min-w-0 items-center overflow-hidden gap-4 rounded-[20px] p-5">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-[rgba(21,20,20,.1)] bg-[#f6f3ee] text-[#151414]" aria-hidden="true">
        {icon}
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm text-[var(--tba-text-2,#46464a)]" title={label}>{label}</p>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="text-2xl font-bold tabular-nums text-[var(--tba-text,#151414)]">{value}</span>
          {!hideTrend && <Trend pct={changePct} lowerIsBetter={lowerIsBetter} />}
        </div>
      </div>
    </div>
  );
}
