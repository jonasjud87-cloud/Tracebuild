"use client";

import type { SystemService } from "./types";

interface Props {
  services: SystemService[];
  checkedAt?: string | null;
  loading?: boolean;
  onRefresh?: () => void;
}

const statusCfg = {
  online:   { dot: "bg-[#2f8a5b]",  label: "Online",             text: "text-[#136a40]" },
  degraded: { dot: "bg-[#b97a0c]",    label: "Beeinträchtigt",     text: "text-[#7a4f00]"   },
  offline:  { dot: "bg-[#c0463d]",      label: "Offline",            text: "text-[#a3201a]"     },
  unknown:  { dot: "bg-[#6B6B6E]",    label: "Nicht konfiguriert", text: "text-[#5f5f64]"   },
} as const;

function RefreshBtn({ loading, onRefresh }: { loading?: boolean; onRefresh?: () => void }) {
  if (!onRefresh) return null;
  return (
    <button
      onClick={onRefresh}
      disabled={loading}
      title="Erneut prüfen"
      className="text-[#5f5f64] hover:text-[var(--tba-text,#151414)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
    >
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" className={loading ? "animate-spin" : ""}>
        <path d="M10.5 6A4.5 4.5 0 1 1 9.16 2.84M10.5 1.5v3h-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

export default function SystemStatus({ services, checkedAt, loading, onRefresh }: Props) {
  if (services.length === 0) {
    return (
      <div className="tba-glass tba-glass--flat rounded-[20px] overflow-hidden">
        <div className="px-5 py-4 border-b border-[rgba(21,20,20,.1)] flex items-center justify-between">
          <h3 className="text-sm font-semibold text-[var(--tba-text,#151414)]">Systemstatus</h3>
          <RefreshBtn loading={loading} onRefresh={onRefresh} />
        </div>
        <div className="p-5 space-y-2">
          {loading ? (
            [1, 2, 3].map(i => <div key={i} className="h-9 bg-[rgba(21,20,20,.05)] rounded-lg animate-pulse" />)
          ) : (
            <p className="text-[13px] text-[#5f5f64]">Status konnte nicht geladen werden.</p>
          )}
        </div>
      </div>
    );
  }

  const hasOffline  = services.some(s => s.status === "offline");
  const hasDegraded = services.some(s => s.status === "degraded");
  const bannerLabel = hasOffline ? "Störung erkannt" : hasDegraded ? "Beeinträchtigt" : "Alle Systeme OK";
  const bannerCls   = hasOffline
    ? "bg-[#D87979]/15 text-[#a3201a]"
    : hasDegraded
      ? "bg-[#D6A45F]/15 text-[#7a4f00]"
      : "bg-[#65A88A]/15 text-[#136a40]";
  const bannerDot = hasOffline ? "bg-[#D87979]" : hasDegraded ? "bg-[#D6A45F]" : "bg-[#65A88A]";

  return (
    <div className="tba-glass tba-glass--flat rounded-[20px] overflow-hidden">
      <div className="px-5 py-4 border-b border-[rgba(21,20,20,.1)] flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--tba-text,#151414)]">Systemstatus</h3>
        <div className="flex items-center gap-3">
          <span className={`inline-flex items-center gap-1.5 text-[13px] font-semibold px-2 py-0.5 rounded-full ${bannerCls}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${bannerDot}`} />
            {bannerLabel}
          </span>
          <RefreshBtn loading={loading} onRefresh={onRefresh} />
        </div>
      </div>

      <div className="divide-y divide-[rgba(21,20,20,.08)]">
        {services.map(service => {
          const cfg = statusCfg[service.status];
          return (
            <div key={service.key} className="flex items-center gap-3 px-5 py-3 hover:bg-[#f6f3ee] transition-colors">
              <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[var(--tba-text,#151414)] font-medium truncate">{service.name}</p>
                {service.status !== "online" && service.note && (
                  <p className="text-[13px] text-[#5f5f64] truncate mt-0.5">{service.note}</p>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                {service.latencyMs !== undefined && (
                  <span className="text-[13px] tabular-nums text-[#5f5f64]">
                    {service.latencyMs >= 1000
                      ? `${(service.latencyMs / 1000).toFixed(1)}s`
                      : `${service.latencyMs}ms`}
                  </span>
                )}
                <span className={`text-[13px] font-medium ${cfg.text}`}>{cfg.label}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="px-5 py-3 border-t border-[rgba(21,20,20,.1)] bg-[rgba(21,20,20,.05)]">
        <p className="text-[13px] text-[#5f5f64]">
          {loading
            ? "Wird geprüft…"
            : checkedAt
              ? `Zuletzt geprüft: ${new Date(checkedAt).toLocaleTimeString("de-CH", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
              : "Noch nicht geprüft"}
        </p>
      </div>
    </div>
  );
}
