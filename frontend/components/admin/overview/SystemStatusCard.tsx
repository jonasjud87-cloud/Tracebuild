import { Card } from "./CardFrame";

type Status = "online" | "degraded" | "offline" | "unknown";

export interface StatusService {
  name: string;
  key: string;
  status: Status;
  latencyMs?: number;
  note?: string;
}

export interface SystemStatusData {
  services: StatusService[];
  checkedAt?: string | null;
}

const CFG: Record<Status, { label: string; text: string }> = {
  online: { label: "Online", text: "text-emerald-400" },
  degraded: { label: "Verlangsamt", text: "text-amber-400" },
  offline: { label: "Offline", text: "text-red-400" },
  unknown: { label: "Unbekannt", text: "text-[#ABAEBB]" },
};

function Icon({ status }: { status: Status }) {
  const p = { width: 16, height: 16, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true, className: `shrink-0 ${CFG[status].text}` } as const;
  const s = { stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  if (status === "online") return <svg {...p}><path d="M3 8.5 6.5 12 13 4.5" {...s} /></svg>;
  if (status === "degraded") return <svg {...p}><circle cx="8" cy="8" r="6" {...s} /><path d="M8 4.5V8l2.2 1.4" {...s} /></svg>;
  if (status === "offline") return <svg {...p}><path d="M4 4l8 8M12 4l-8 8" {...s} /></svg>;
  return <svg {...p}><circle cx="8" cy="8" r="6" {...s} /><path d="M6.4 6.3A1.7 1.7 0 0 1 8 5.2c.95 0 1.7.65 1.7 1.5 0 1.1-1.7 1.3-1.7 2.4M8 11.2v.1" {...s} /></svg>;
}

function overall(services: StatusService[]): { label: string; cls: string; status: Status } {
  if (services.some(s => s.status === "offline")) return { label: "Störung", cls: "bg-red-500/15 text-red-300", status: "offline" };
  if (services.some(s => s.status !== "online")) return { label: "Eingeschränkt", cls: "bg-amber-500/15 text-amber-300", status: "degraded" };
  return { label: "Alle Systeme aktiv", cls: "bg-emerald-500/15 text-emerald-300", status: "online" };
}

function formatLatency(ms: number) {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}

function checkedTime(iso?: string | null) {
  if (!iso) return null;
  const d = new Date(iso);
  if (isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("de-CH", { timeZone: "Europe/Zurich", hour: "2-digit", minute: "2-digit" });
}

export default function SystemStatusCard({ data, className = "" }: { data: SystemStatusData; className?: string }) {
  const services = Array.isArray(data.services) ? data.services : [];
  const badge = overall(services);
  const time = checkedTime(data.checkedAt);

  return (
    <Card
      title="Systemstatus"
      className={className}
      action={
        services.length > 0 ? (
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.cls}`}>
            <Icon status={badge.status} />
            {badge.label}
          </span>
        ) : undefined
      }
    >
      {services.length === 0 ? (
        <p className="text-sm text-[#ABAEBB]">Keine Dienste gemeldet.</p>
      ) : (
        <ul className="divide-y divide-[rgba(60,63,68,0.3)]">
          {services.map(s => {
            const st: Status = CFG[s.status] ? s.status : "unknown";
            const c = CFG[st];
            return (
              <li key={s.key} className="flex items-center gap-3 py-3">
                <Icon status={st} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-white">{s.name}</p>
                  {st !== "online" && s.note && <p className="truncate text-xs text-[#ABAEBB]">{s.note}</p>}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {typeof s.latencyMs === "number" && (
                    <span className="hidden text-xs tabular-nums text-[#ABAEBB] sm:inline">{formatLatency(s.latencyMs)}</span>
                  )}
                  <span className={`text-sm font-medium ${c.text}`}>{c.label}</span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      {time && <p className="mt-2 text-xs text-[#ABAEBB]">Zuletzt geprüft: {time}</p>}
    </Card>
  );
}
