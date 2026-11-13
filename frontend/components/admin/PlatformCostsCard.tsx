"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

interface Row {
  month: string;
  source: "digest" | "oereb_ocr";
  usd: number;
  count: number;
}

interface Payload {
  usdToChf: number;
  rows: Row[];
}

const SOURCE_LABEL: Record<Row["source"], string> = {
  digest: "Prüfauszüge der Bundesnormen",
  oereb_ocr: "ÖREB-Import, Lesen von Scans",
};

function chf(usd: number, rate: number): string {
  return `CHF ${(usd * rate).toFixed(2)}`;
}

function monthLabel(month: string): string {
  const [y, m] = month.split("-");
  const names = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
  return `${names[Number(m) - 1] ?? m} ${y}`;
}

export default function PlatformCostsCard() {
  const [data, setData] = useState<Payload | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    api
      .get<Payload>("/admin/platform-costs")
      .then(setData)
      .catch(() => setFailed(true));
  }, []);

  if (failed) return <p className="text-sm text-[#a3201a]">Plattformkosten konnten nicht geladen werden.</p>;
  if (!data) return null;

  const months = Array.from(new Set(data.rows.map((r) => r.month))).slice(0, 6);
  const total = data.rows.reduce((sum, r) => sum + r.usd, 0);

  return (
    <section aria-label="Plattformkosten" className="tba-card rounded-2xl border border-[#cbbfae]/30 bg-white p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <h3 className="text-base font-semibold text-[#151414]">Plattformkosten</h3>
          <p className="mt-1 text-sm text-[#5f5f64]">
            Kosten, die TraceBuild selbst trägt und keiner Organisation zugeordnet sind. Sie stehen nicht in der Kostenübersicht der Kunden oben.
          </p>
        </div>
        <p className="text-right text-sm text-[#46464a]">
          Gesamt bisher
          <span className="block text-xl font-bold tabular-nums text-[#6b6153]">{chf(total, data.usdToChf)}</span>
        </p>
      </div>
      {months.length === 0 ? (
        <p className="mt-3 text-sm text-[#5f5f64]">Noch keine Plattformkosten erfasst.</p>
      ) : (
        <ul className="mt-3 divide-y divide-[rgba(21,20,20,0.08)]">
          {months.map((month) => {
            const rows = data.rows.filter((r) => r.month === month);
            const sum = rows.reduce((s, r) => s + r.usd, 0);
            return (
              <li key={month} className="py-2.5">
                <p className="flex items-baseline justify-between gap-3 text-sm font-semibold text-[#151414]">
                  <span>{monthLabel(month)}</span>
                  <span className="tabular-nums">{chf(sum, data.usdToChf)}</span>
                </p>
                <ul className="mt-1 space-y-0.5">
                  {rows.map((r) => (
                    <li key={r.source} className="flex items-baseline justify-between gap-3 text-sm text-[#5f5f64]">
                      <span>{SOURCE_LABEL[r.source]} ({r.count})</span>
                      <span className="tabular-nums">{chf(r.usd, data.usdToChf)}</span>
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
