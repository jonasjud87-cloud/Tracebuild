"use client";

import type { Activity, ActivityType } from "./types";

type ActivityCfg = { label: string; dot: string; text: string; bg: string };

const cfg: Record<ActivityType, ActivityCfg> = {
  org_created:        { label: "Organisation erstellt",  dot: "bg-[#2f8a5b]",  text: "text-[#136a40]",  bg: "bg-[#65A88A]/10"  },
  org_opened:         { label: "Organisation geöffnet",  dot: "bg-[#8f836f]",   text: "text-[#6b6153]",   bg: "bg-[#CBBFAE]/10"      },
  org_edited:         { label: "Bearbeitet",             dot: "bg-[#8f836f]",    text: "text-[#6b6153]",    bg: "bg-[#B5A893]/15"    },
  org_closed:         { label: "Geschlossen",            dot: "bg-[#6B6B6E]",    text: "text-[var(--tba-text-2,#46464a)]",    bg: "bg-[rgba(21,20,20,.06)]" },
  org_archived:       { label: "Archiviert",             dot: "bg-[#55555A]",    text: "text-[#5f5f64]",    bg: "bg-[rgba(21,20,20,.06)]" },
  org_paused:         { label: "Pausiert",               dot: "bg-[#b97a0c]",    text: "text-[#7a4f00]",    bg: "bg-[#D6A45F]/10"    },
  user_invited:       { label: "Benutzer eingeladen",    dot: "bg-[#8f836f]",    text: "text-[#6b6153]",    bg: "bg-[#CBBFAE]/10"   },
  project_created:    { label: "Projekt erstellt",       dot: "bg-[#8f836f]",    text: "text-[#6b6153]",    bg: "bg-[#CBBFAE]/10"      },
  plan_uploaded:      { label: "Plan hochgeladen",       dot: "bg-[#8f836f]",    text: "text-[#6b6153]",    bg: "bg-[#B5A893]/10"   },
  analyse_started:    { label: "Analyse gestartet",      dot: "bg-[#b97a0c]",    text: "text-[#7a4f00]",    bg: "bg-[#D6A45F]/10"   },
  analyse_completed:  { label: "Analyse abgeschlossen",  dot: "bg-[#2f8a5b]",  text: "text-[#136a40]",  bg: "bg-[#65A88A]/10"  },
  report_created:     { label: "Bericht erstellt",       dot: "bg-[#2f8a5b]",    text: "text-[#136a40]",    bg: "bg-[#65A88A]/10"     },
  cost_limit_reached: { label: "Kostenlimit erreicht",   dot: "bg-[#c0463d]",      text: "text-[#a3201a]",      bg: "bg-[#D87979]/10"      },
  plan_changed:       { label: "Tarif geändert",         dot: "bg-[#b97a0c]",    text: "text-[#7a4f00]",    bg: "bg-[#D6A45F]/10"    },
};

function relTime(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (m < 1)  return "Gerade eben";
  if (m < 60) return `vor ${m} Min.`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h} Std.`;
  const d = Math.floor(h / 24);
  return d === 1 ? "Gestern" : `vor ${d} Tagen`;
}

interface Props { activities: Activity[] }

export default function ActivityFeed({ activities }: Props) {
  return (
    <div className="tba-glass tba-glass--flat rounded-[20px] overflow-hidden">
      <div className="px-5 py-4 border-b border-[rgba(21,20,20,.1)] flex items-center justify-between">
        <h3 className="text-sm font-semibold text-[var(--tba-text,#151414)]">Letzte Aktivitäten</h3>
        {activities.length > 0 && (
          <span className="text-[13px] font-semibold text-[#5f5f64] bg-[rgba(21,20,20,.05)] px-2 py-0.5 rounded-full tabular-nums">
            {activities.length}
          </span>
        )}
      </div>

      {activities.length === 0 ? (
        <div className="px-5 py-10 text-center">
          <p className="text-sm text-[var(--tba-text-2,#46464a)]">Noch keine Aktivitäten</p>
          <p className="text-sm text-[#5f5f64] mt-1">Erstelle oder öffne eine Organisation</p>
        </div>
      ) : (
        <div className="divide-y divide-[rgba(21,20,20,.08)] max-h-[520px] overflow-y-auto scrollbar-light">
          {activities.map(a => {
            const c = cfg[a.type];
            return (
              <div key={a.id} className="flex items-start gap-3 px-5 py-3.5 hover:bg-[#f6f3ee] transition-colors">
                <div className={`mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center flex-shrink-0 ${c.bg}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-[var(--tba-text,#151414)] truncate">{a.orgName}</p>
                  <p className={`text-sm font-medium mt-0.5 ${c.text}`}>{c.label}</p>
                  {(a.user || a.meta) && (
                    <p className="text-sm text-[#5f5f64] mt-0.5 truncate">
                      {a.user && <span>{a.user}</span>}
                      {a.user && a.meta && <span> · </span>}
                      {a.meta && <span>{a.meta}</span>}
                    </p>
                  )}
                </div>
                <span className="text-sm text-[#5f5f64] flex-shrink-0 mt-0.5 tabular-nums whitespace-nowrap">
                  {relTime(a.timestamp)}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
