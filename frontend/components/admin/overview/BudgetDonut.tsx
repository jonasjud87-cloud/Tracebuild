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
        <p className="py-10 text-center text-sm text-[var(--tba-text-2,#46464a)]">Kein Monatsbudget hinterlegt</p>
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
  const color = over ? "#b42318" : "#151414";
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
          <circle cx="60" cy="60" r={R} fill="none" stroke="rgba(203,191,174,0.5)" strokeWidth="12" />
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
          <span className={`text-2xl font-bold tabular-nums ${over ? "text-[#a3201a]" : "text-[var(--tba-text,#151414)]"}`}>{rounded}%</span>
          <span className="text-[13px] text-[var(--tba-text-2,#46464a)]">vom Budget</span>
        </div>
      </div>
      <dl className="min-w-0 max-w-[280px] flex-1 basis-[150px] space-y-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="flex items-center gap-2 text-[var(--tba-text-2,#46464a)]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
            Verbraucht
          </dt>
          <dd className="font-semibold tabular-nums text-[var(--tba-text,#151414)]">{formatMoney(budget.usedUsd, currency)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="flex items-center gap-2 text-[var(--tba-text-2,#46464a)]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#cbbfae]" aria-hidden="true" />
            Verfügbar
          </dt>
          <dd className="font-semibold tabular-nums text-[var(--tba-text,#151414)]">{formatMoney(available, currency)}</dd>
        </div>
        <div className="border-t border-[rgba(21,20,20,.1)] pt-2 text-[13px] text-[var(--tba-text-2,#46464a)]">
          Budget {formatMoney(budget.budgetUsd, currency)}
          {budget.orgsWithBudget > 0 && ` · ${budget.orgsWithBudget} ${budget.orgsWithBudget === 1 ? "Organisation" : "Organisationen"}`}
        </div>
        {over && <p className="text-[13px] font-semibold text-[#a3201a]">Budget überschritten</p>}
      </dl>
    </div>
  );
}
