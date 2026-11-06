"use client";

import { useId, useMemo, useState, type KeyboardEvent } from "react";
import type { OverviewSeriesPoint } from "@/lib/admin-overview/types";
import { Card, focusRing } from "./CardFrame";
import { formatDayLabel, formatDayLong, formatInt, niceScale } from "./format";

const PLOT_H = 170;

export default function AnalysesChart({ series }: { series: OverviewSeriesPoint[] }) {
  const tableId = useId();
  const points = useMemo(() => series.slice(-30), [series]);
  const [active, setActive] = useState<number | null>(null);
  const n = points.length;
  const max = useMemo(() => points.reduce((m, p) => Math.max(m, p.count), 0), [points]);
  const scale = useMemo(() => niceScale(max), [max]);
  const total = points.reduce((s, p) => s + p.count, 0);

  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (n === 0) return;
    const cur = active ?? n - 1;
    let next = cur;
    if (e.key === "ArrowLeft") next = Math.max(cur - 1, 0);
    else if (e.key === "ArrowRight") next = Math.min(cur + 1, n - 1);
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = n - 1;
    else if (e.key === "Escape") {
      setActive(null);
      return;
    } else return;
    e.preventDefault();
    setActive(next);
  };

  const label =
    n === 0
      ? "Analysen im Zeitverlauf: keine Daten"
      : `Balkendiagramm: Analysen pro Tag von ${formatDayLong(points[0].date)} bis ${formatDayLong(points[n - 1].date)}, insgesamt ${formatInt(total)}, Maximum ${formatInt(max)} pro Tag`;

  const tip = active !== null ? points[active] : null;
  const tipPct = tip ? (tip.count / scale.top) * 100 : 0;
  const tipX = active !== null ? ((active + 0.5) / n) * 100 : 0;
  const tipShift = active !== null && active < 3 ? "0%" : active !== null && active > n - 4 ? "-100%" : "-50%";

  return (
    <Card title="Analysen im Zeitverlauf" subtitle="Anzahl Planprüfungen pro Tag, letzte 30 Tage">
      {n === 0 ? (
        <p className="py-10 text-center text-sm text-[var(--tba-text-2,#A7AFBA)]">Noch keine Analysen im Zeitraum.</p>
      ) : (
        <>
          <div className="mt-6 flex gap-2">
            <div className="relative w-8 shrink-0" style={{ height: PLOT_H }} aria-hidden="true">
              {scale.ticks.map(t => (
                <span
                  key={t}
                  className="absolute right-0 translate-y-1/2 text-xs tabular-nums text-[var(--tba-text-2,#A7AFBA)]"
                  style={{ bottom: `${(t / scale.top) * 100}%` }}
                >
                  {t}
                </span>
              ))}
            </div>
            <div className="min-w-0 flex-1">
              <div
                role="img"
                aria-label={label}
                aria-describedby={tableId}
                tabIndex={0}
                onKeyDown={onKey}
                onFocus={() => setActive(a => a ?? n - 1)}
                onBlur={() => setActive(null)}
                onMouseLeave={() => setActive(null)}
                className={`relative rounded-sm ${focusRing}`}
                style={{ height: PLOT_H }}
              >
                {scale.ticks.map(t => (
                  <div
                    key={t}
                    className="absolute inset-x-0 border-t border-white/[0.06]"
                    style={{ bottom: `${(t / scale.top) * 100}%` }}
                  />
                ))}
                <div className="absolute inset-0 flex items-end gap-[2px] sm:gap-1">
                  {points.map((p, i) => (
                    <div
                      key={p.date + i}
                      className="flex h-full min-w-0 flex-1 items-end"
                      onMouseEnter={() => setActive(i)}
                    >
                      <div
                        className={`w-full rounded-t-[4px] motion-safe:transition-[height,background-color] motion-safe:duration-300 ${
                          active === i ? "bg-[#FDF6EE]" : "bg-[#F0C99A]"
                        } ${p.count === 0 ? "opacity-20" : ""}`}
                        style={{ height: p.count === 0 ? 2 : `${(p.count / scale.top) * 100}%` }}
                      />
                    </div>
                  ))}
                </div>
                {tip && (
                  <div
                    className="pointer-events-none absolute z-10 whitespace-nowrap rounded-lg border border-white/10 bg-[#080D16]/90 px-2.5 py-1.5 text-xs text-[var(--tba-text,#F4F3F0)] shadow-lg backdrop-blur"
                    style={{ left: `${tipX}%`, bottom: `calc(${tipPct}% + 8px)`, transform: `translateX(${tipShift})` }}
                  >
                    <span className="text-[var(--tba-text-2,#A7AFBA)]">{formatDayLabel(tip.date)}</span>
                    <span className="mx-1.5 text-[var(--tba-text-2,#A7AFBA)]">·</span>
                    <span className="font-semibold">{formatInt(tip.count)} {tip.count === 1 ? "Analyse" : "Analysen"}</span>
                  </div>
                )}
              </div>
              <div className="relative mt-2 h-5" aria-hidden="true">
                {points.map((p, i) =>
                  i % 3 === 0 ? (
                    <span
                      key={p.date + i}
                      className={`absolute -translate-x-1/2 whitespace-nowrap text-xs text-[var(--tba-text-2,#A7AFBA)] ${i % 6 === 0 ? "" : "hidden sm:inline"}`}
                      style={{ left: `${((i + 0.5) / n) * 100}%` }}
                    >
                      {formatDayLabel(p.date)}
                    </span>
                  ) : null
                )}
              </div>
            </div>
          </div>
          <table id={tableId} className="sr-only">
            <caption>Analysen pro Tag</caption>
            <thead>
              <tr>
                <th scope="col">Datum</th>
                <th scope="col">Anzahl Analysen</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={p.date + i}>
                  <th scope="row">{formatDayLong(p.date)}</th>
                  <td>{p.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </Card>
  );
}
