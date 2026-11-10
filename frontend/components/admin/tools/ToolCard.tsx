"use client";

import { useCallback, useEffect } from "react";
import type { CardResult, CardState, DataSource, Metric, ProviderInfo } from "@/lib/tool-monitoring/types";
import { Card, CardError, CardSkeleton } from "../overview/CardFrame";
import { fetchEnvelope, useResource } from "../overview/resource";

export const CARD_URL = "/api/v1/admin/tool-monitoring";

const STATE_CFG: Record<CardState, { label: string; pill: string; bar: string }> = {
  ok: { label: "OK", pill: "bg-[#65A88A]/15 text-[#136a40]", bar: "bg-[#65A88A]" },
  warn: { label: "Warnung", pill: "bg-[#D6A45F]/15 text-[#7a4f00]", bar: "bg-[#D6A45F]" },
  error: { label: "Störung", pill: "bg-[#D87979]/15 text-[#a3201a]", bar: "bg-[#D87979]" },
  unconfigured: { label: "Nicht eingerichtet", pill: "bg-[rgba(21,20,20,.05)] text-[#46464a]", bar: "bg-[#46464a]" },
};

const SOURCE_LABEL: Record<DataSource, string> = { api: "aus API", plan: "Planwert", db: "aus DB" };

const STATES = new Set<string>(["ok", "warn", "error", "unconfigured"]);

function isCard(d: unknown): d is CardResult {
  if (typeof d !== "object" || d === null) return false;
  const c = d as Record<string, unknown>;
  return (
    typeof c.provider === "string" &&
    typeof c.state === "string" &&
    STATES.has(c.state) &&
    Array.isArray(c.metrics) &&
    Array.isArray(c.costs) &&
    Array.isArray(c.links) &&
    Array.isArray(c.notes) &&
    typeof c.usdToChf === "number"
  );
}

function StatePill({ state }: { state: CardState }) {
  const cfg = STATE_CFG[state];
  return <span className={`shrink-0 rounded-full px-2.5 py-1 text-[12px] font-semibold ${cfg.pill}`}>{cfg.label}</span>;
}

function SourceBadge({ source }: { source: DataSource }) {
  return (
    <span className="ml-1.5 rounded-full border border-[rgba(21,20,20,.12)] px-1.5 py-px text-[11px] font-medium text-[var(--tba-text-2,#46464a)]">
      {SOURCE_LABEL[source]}
    </span>
  );
}

function QuotaBar({ metric }: { metric: Metric }) {
  const q = metric.quota;
  if (!q || q.limit === null || q.limit <= 0) return null;
  const pct = Math.min(100, Math.max(0, (q.used / q.limit) * 100));
  const cfg = STATE_CFG[metric.state ?? "ok"];
  return (
    <div
      className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-[rgba(21,20,20,.07)]"
      role="progressbar"
      aria-label={`${metric.label}: ${Math.round(pct)} % genutzt`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pct)}
    >
      <div className={`h-full rounded-full ${cfg.bar}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

function money(n: number, code: "USD" | "CHF"): string {
  const v = Number.isFinite(n) ? n : 0;
  return `${code} ${v.toLocaleString("de-CH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function checkedTime(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" });
}

function CardBody({ data }: { data: CardResult }) {
  const time = checkedTime(data.checkedAt);
  return (
    <div className="space-y-4 text-[14px]">
      {data.message && <p className="text-[var(--tba-text,#151414)]">{data.message}</p>}

      {data.metrics.length > 0 && (
        <dl className="space-y-2.5">
          {data.metrics.map((m, i) => (
            <div key={`${m.label}-${i}`}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <dt className="flex items-center text-[var(--tba-text-2,#46464a)]">
                  {m.state && m.state !== "ok" && <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${STATE_CFG[m.state].bar}`} aria-hidden="true" />}
                  {m.label}
                  <SourceBadge source={m.source} />
                </dt>
                <dd className="min-w-0 break-words text-right font-semibold text-[var(--tba-text,#151414)]">
                  {m.value}
                  {m.state && m.state !== "ok" && <span className="sr-only"> ({STATE_CFG[m.state].label})</span>}
                </dd>
              </div>
              <QuotaBar metric={m} />
              {m.hint && <p className="mt-0.5 text-[12px] text-[var(--tba-text-2,#46464a)]">{m.hint}</p>}
            </div>
          ))}
        </dl>
      )}

      {data.costs.length > 0 && (
        <div>
          <h3 className="mb-1.5 text-[13px] font-semibold uppercase tracking-[0.08em] text-[var(--tba-text-2,#46464a)]">Kosten</h3>
          <ul className="space-y-1.5">
            {data.costs.map((c, i) => (
              <li key={`${c.label}-${i}`} className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-[var(--tba-text-2,#46464a)]">
                  {c.label}
                  <SourceBadge source={c.source} />
                  {c.note && <span className="block text-[12px]">{c.note}</span>}
                </span>
                <span className="text-right font-semibold text-[var(--tba-text,#151414)]">
                  {money(c.usd, "USD")}
                  <span className="block text-[12px] font-normal text-[var(--tba-text-2,#46464a)]">{money(c.usd * data.usdToChf, "CHF")}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {data.notes.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-[13px] text-[var(--tba-text-2,#46464a)]">
          {data.notes.map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      )}

      {data.links.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-[13px]">
          {data.links.map(l => (
            <a key={l.href + l.label} href={l.href} target="_blank" rel="noopener noreferrer" className="font-semibold text-[var(--tba-text,#151414)] underline underline-offset-2">
              {l.label}
            </a>
          ))}
        </div>
      )}

      {time && (
        <p className="text-[12px] text-[var(--tba-text-2,#46464a)]">
          Geprüft {time}
          {data.cached ? " · aus Zwischenspeicher" : ""}
        </p>
      )}
    </div>
  );
}

export default function ToolCard({ info, refreshNonce, onBusy }: { info: ProviderInfo; refreshNonce: number; onBusy: (key: string, busy: boolean) => void }) {
  const load = useCallback(async () => {
    const url = `${CARD_URL}/${encodeURIComponent(info.key)}${refreshNonce > 0 ? "?fresh=1" : ""}`;
    const d = await fetchEnvelope<CardResult>(url, `${info.title} konnte nicht geprüft werden.`);
    if (!isCard(d)) throw new Error("Unerwartete Antwort.");
    return d;
  }, [info.key, info.title, refreshNonce]);
  const [res, retry, busy] = useResource(load);

  useEffect(() => {
    onBusy(info.key, busy);
  }, [busy, info.key, onBusy]);

  const state: CardState | null = res.status === "ready" ? res.data.state : null;

  return (
    <Card title={info.title} action={state ? <StatePill state={state} /> : undefined}>
      {res.status === "ready" ? (
        <CardBody data={res.data} />
      ) : res.status === "error" ? (
        <CardError message={res.message} onRetry={retry} />
      ) : (
        <CardSkeleton rows={3} />
      )}
    </Card>
  );
}
