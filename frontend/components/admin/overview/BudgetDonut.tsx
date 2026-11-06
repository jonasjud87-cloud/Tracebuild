import type { OverviewBudget } from "@/lib/admin-overview/types";
import { Card } from "./CardFrame";
import { formatMoney, type DisplayCurrency } from "./format";

const R = 48;
const C = 2 * Math.PI * R;

export default function BudgetDonut({ budget, currency }: { budget: OverviewBudget; currency: DisplayCurrency }) {
  const pct = budget.percent;
  return (
    <Card title="Nutzung (Monat)" subtitle="Budget-Auslastung">
      {pct === null || !Number.isFinite(pct) ? (
        <p className="py-10 text-center text-sm text-[var(--tba-text-2,#A7AFBA)]">Kein Monatsbudget hinterlegt</p>
      ) : (
        <DonutBody pct={pct} budget={budget} currency={currency} />
      )}
    </Card>
  );
}

function DonutBody({ pct, budget, currency }: { pct: number; budget: OverviewBudget; currency: DisplayCurrency }) {
  const over = pct > 100;
  const shown = Math.min(Math.max(pct, 0), 100);
  const arc = (shown / 100) * C;
  const available = Math.max(budget.budgetUsd - budget.usedUsd, 0);
  const color = over ? "#D87979" : "#F0C99A";
  const rounded = Math.round(pct);

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-4">
      <div className="relative h-[112px] w-[112px] shrink-0">
        <svg
          viewBox="0 0 120 120"
          className="h-full w-full -rotate-90"
          role="img"
          aria-label={`Budget zu ${rounded} Prozent verbraucht${over ? ", Budget überschritten" : ""}`}
        >
          <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="12" />
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap="butt"
            strokeDasharray={`${arc} ${C}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center" aria-hidden="true">
          <span className={`text-2xl font-bold tabular-nums ${over ? "text-[#E58C8C]" : "text-[var(--tba-text,#F4F3F0)]"}`}>{rounded}%</span>
          <span className="text-xs text-[var(--tba-text-2,#A7AFBA)]">vom Budget</span>
        </div>
      </div>
      <dl className="min-w-0 max-w-[280px] flex-1 basis-[150px] space-y-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="flex items-center gap-2 text-[var(--tba-text-2,#A7AFBA)]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
            Verbraucht
          </dt>
          <dd className="font-semibold tabular-nums text-[var(--tba-text,#F4F3F0)]">{formatMoney(budget.usedUsd, currency)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="flex items-center gap-2 text-[var(--tba-text-2,#A7AFBA)]">
            <span className="h-2.5 w-2.5 rounded-full bg-white/25" aria-hidden="true" />
            Verfügbar
          </dt>
          <dd className="font-semibold tabular-nums text-[var(--tba-text,#F4F3F0)]">{formatMoney(available, currency)}</dd>
        </div>
        <div className="border-t border-white/[0.08] pt-2 text-xs text-[var(--tba-text-2,#A7AFBA)]">
          Budget {formatMoney(budget.budgetUsd, currency)}
          {budget.orgsWithBudget > 0 && ` · ${budget.orgsWithBudget} ${budget.orgsWithBudget === 1 ? "Organisation" : "Organisationen"}`}
        </div>
        {over && <p className="text-xs font-semibold text-[#E58C8C]">Budget überschritten</p>}
      </dl>
    </div>
  );
}
