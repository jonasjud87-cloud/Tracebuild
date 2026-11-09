import type { AnalysisRow, AnalysisView } from "@/lib/admin-analyses/types";

export type RangeKey = "default" | "24h" | "7d" | "30d" | "all";

export const RANGE_OPTIONS: { key: RangeKey; label: string }[] = [
  { key: "default", label: "Standard der Ansicht" },
  { key: "24h", label: "Letzte 24 Stunden" },
  { key: "7d", label: "Letzte 7 Tage" },
  { key: "30d", label: "Letzte 30 Tage" },
  { key: "all", label: "Gesamter Zeitraum" },
];

export const VIEW_LABELS: Record<AnalysisView, string> = {
  running: "Laufend",
  failed: "Fehlgeschlagen",
  expensive: "Teuer",
  all: "Alle",
};

export const VIEW_ORDER: AnalysisView[] = ["running", "failed", "expensive", "all"];

const HOUR = 3_600_000;

export function rangeToFrom(range: RangeKey, now: number): string | null {
  if (range === "default") return null;
  if (range === "all") return "2000-01-01T00:00:00.000Z";
  const span = range === "24h" ? 24 * HOUR : range === "7d" ? 7 * 24 * HOUR : 30 * 24 * HOUR;
  return new Date(now - span).toISOString();
}

export type StatusTone = "running" | "orphaned" | "error" | "cancelled" | "done" | "neutral";

export interface StatusMeta {
  tone: StatusTone;
  label: string;
  badge: string;
}

export function statusMeta(status: string, orphaned: boolean): StatusMeta {
  if (status === "running" && orphaned) {
    return { tone: "orphaned", label: "Verwaist", badge: "bg-[#D6A45F]/15 text-[#D6A45F] border-[#D6A45F]/30" };
  }
  switch (status) {
    case "running":
      return { tone: "running", label: "Laufend", badge: "bg-[#CBBFAE]/15 text-[#CBBFAE] border-[#CBBFAE]/30" };
    case "error":
      return { tone: "error", label: "Fehlgeschlagen", badge: "bg-[#D87979]/15 text-[#EBA1A1] border-[#D87979]/30" };
    case "cancelled":
      return { tone: "cancelled", label: "Abgebrochen", badge: "bg-white/10 text-[#D5D5D5] border-white/20" };
    case "done":
      return { tone: "done", label: "Abgeschlossen", badge: "bg-[#65A88A]/15 text-[#8FD0B1] border-[#65A88A]/30" };
    default:
      return { tone: "neutral", label: status || "Unbekannt", badge: "bg-white/10 text-[#D5D5D5] border-white/20" };
  }
}

/** Massgebend ist die letzte Aktivität: Lange Analysen laufen gesund über die Schwelle hinaus. */
export function isOrphaned(
  row: Pick<AnalysisRow, "status" | "createdAt"> & { lastActivityAt?: string | null },
  now: number,
  orphanMinutes: number,
): boolean {
  if (row.status !== "running") return false;
  const reference = Date.parse(row.lastActivityAt ?? row.createdAt);
  return Number.isFinite(reference) && now - reference > orphanMinutes * 60_000;
}

export function formatDuration(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms < 0) return "—";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec} s`;
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  if (min < 60) return `${min} min ${String(sec).padStart(2, "0")} s`;
  const h = Math.floor(min / 60);
  return `${h} h ${String(min % 60).padStart(2, "0")} min`;
}

export function elapsedMs(row: AnalysisRow, now: number): number | null {
  const created = Date.parse(row.createdAt);
  if (!Number.isFinite(created)) return null;
  return Math.max(0, now - created);
}

export function rowDuration(row: AnalysisRow, now: number): { text: string; live: boolean } {
  if (row.status === "running") return { text: formatDuration(elapsedMs(row, now)), live: true };
  return { text: formatDuration(row.durationMs), live: false };
}

export function formatCost(chf: number | null): string {
  if (chf === null || !Number.isFinite(chf)) return "—";
  return `CHF ${chf >= 1 ? chf.toFixed(2) : chf.toFixed(4)}`;
}

export function formatCostTotal(chf: number): string {
  return `CHF ${chf.toFixed(2)}`;
}

export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("de-CH", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatAgo(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return "—";
  const sec = Math.max(0, Math.round((now - t) / 1000));
  if (sec < 60) return "vor wenigen Sekunden";
  const min = Math.floor(sec / 60);
  if (min < 60) return `vor ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `vor ${h} h`;
  return `vor ${Math.floor(h / 24)} Tg.`;
}

export type ActionKind = "cancel";

export function canCancel(row: AnalysisRow): boolean {
  return row.status === "running";
}

export function canRestart(row: AnalysisRow, now: number, orphanMinutes: number): boolean {
  return row.status === "error" || row.status === "cancelled" || isOrphaned(row, now, orphanMinutes);
}

export const RESTART_UNAVAILABLE_HINT = "Neustart noch nicht verfügbar";

export async function requestJson<T>(url: string, init?: RequestInit): Promise<{ data: T } | { error: string }> {
  try {
    const res = await fetch(url, init);
    const json = (await res.json().catch(() => null)) as { data: T | null; error: string | null } | null;
    if (!res.ok || !json || json.error || json.data === null || json.data === undefined) {
      return { error: json?.error ?? `Anfrage fehlgeschlagen (HTTP ${res.status})` };
    }
    return { data: json.data };
  } catch {
    return { error: "Netzwerkfehler. Bitte Verbindung prüfen." };
  }
}
