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
        <p className="py-10 text-center text-sm text-[#ABAEBB]">Kein Monatsbudget hinterlegt</p>
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
  const color = over ? "#F87171" : "#85A6E9";
  const rounded = Math.round(pct);

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:justify-center xl:flex-col 2xl:flex-row">
      <div className="relative h-36 w-36 shrink-0">
        <svg
          viewBox="0 0 120 120"
          className="h-full w-full -rotate-90"
          role="img"
          aria-label={`Budget zu ${rounded} Prozent verbraucht${over ? ", Budget überschritten" : ""}`}
        >
          <circle cx="60" cy="60" r={R} fill="none" stroke="#243452" strokeWidth="12" />
          <circle
            cx="60"
            cy="60"
            r={R}
            fill="none"
            stroke={color}
            strokeWidth="12"
            strokeLinecap={shown > 0 && shown < 100 ? "round" : "butt"}
            strokeDasharray={`${arc} ${C}`}
          />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center text-center" aria-hidden="true">
          <span className={`text-2xl font-bold tabular-nums ${over ? "text-red-400" : "text-white"}`}>{rounded}%</span>
          <span className="text-[11px] text-[#ABAEBB]">vom Budget</span>
        </div>
      </div>
      <dl className="w-full min-w-0 space-y-3 text-sm sm:w-auto">
        <div className="flex items-center justify-between gap-4">
          <dt className="flex items-center gap-2 text-[#ABAEBB]">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
            Verbraucht
          </dt>
          <dd className="font-semibold tabular-nums text-white">{formatMoney(budget.usedUsd, currency)}</dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="flex items-center gap-2 text-[#ABAEBB]">
            <span className="h-2.5 w-2.5 rounded-full bg-[#4B5B7C]" aria-hidden="true" />
            Verfügbar
          </dt>
          <dd className="font-semibold tabular-nums text-white">{formatMoney(available, currency)}</dd>
        </div>
        <div className="border-t border-[rgba(60,63,68,0.5)] pt-2 text-xs text-[#ABAEBB]">
          Budget {formatMoney(budget.budgetUsd, currency)}
          {budget.orgsWithBudget > 0 && ` · ${budget.orgsWithBudget} ${budget.orgsWithBudget === 1 ? "Organisation" : "Organisationen"}`}
        </div>
        {over && <p className="text-xs font-semibold text-red-400">Budget überschritten</p>}
      </dl>
    </div>
  );
}
