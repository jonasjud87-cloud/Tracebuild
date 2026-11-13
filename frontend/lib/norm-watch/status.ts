import type {
  NormSourceRow,
  NormWatchOverview,
  NormWatchSummary,
  SourceView,
  SourceViewStatus,
} from "./types";

export const STALE_DAYS = 10;

const DAY_MS = 86_400_000;

export function deriveStatus(source: NormSourceRow, hasDraft: boolean): SourceViewStatus {
  if (!source.enabled) return "disabled";
  if (hasDraft) return "update_available";
  if (source.status === "error") return "error";
  if (!source.norm_id) return "missing";
  if (!source.last_checked_at || source.status === "unchecked") return "unchecked";
  return "current";
}

export function isStale(sources: NormSourceRow[], now: Date): boolean {
  const active = sources.filter((s) => s.enabled);
  if (active.length === 0) return false;
  return active.some((s) => {
    const checked = s.last_checked_at ? Date.parse(s.last_checked_at) : NaN;
    return !Number.isFinite(checked) || now.getTime() - checked > STALE_DAYS * DAY_MS;
  });
}

export function buildOverview(
  sources: NormSourceRow[],
  draftBySource: Map<string, string>,
  normTitles: Map<string, string>,
  now: Date,
): NormWatchOverview {
  const views: SourceView[] = sources.map((s) => ({
    id: s.id,
    label: s.label,
    provider: s.provider,
    identifier: s.identifier,
    enabled: s.enabled,
    normId: s.norm_id,
    normTitle: s.norm_id ? normTitles.get(s.norm_id) ?? null : null,
    status: deriveStatus(s, draftBySource.has(s.id)),
    appliedLabel: s.applied_label,
    remoteLabel: s.remote_label,
    lastCheckedAt: s.last_checked_at,
    lastError: s.last_error,
    draftId: draftBySource.get(s.id) ?? null,
  }));

  const summary: NormWatchSummary = {
    total: views.length,
    current: 0,
    updateAvailable: 0,
    missing: 0,
    error: 0,
    unchecked: 0,
    disabled: 0,
    lastCheckedAt: null,
    stale: isStale(sources, now),
  };
  for (const v of views) {
    if (v.status === "current") summary.current++;
    else if (v.status === "update_available") summary.updateAvailable++;
    else if (v.status === "missing") summary.missing++;
    else if (v.status === "error") summary.error++;
    else if (v.status === "unchecked") summary.unchecked++;
    else summary.disabled++;
    if (v.lastCheckedAt && (!summary.lastCheckedAt || v.lastCheckedAt > summary.lastCheckedAt)) {
      summary.lastCheckedAt = v.lastCheckedAt;
    }
  }

  const order: Record<SourceViewStatus, number> = {
    update_available: 0,
    error: 1,
    missing: 2,
    unchecked: 3,
    current: 4,
    disabled: 5,
  };
  views.sort((a, b) => order[a.status] - order[b.status] || a.label.localeCompare(b.label, "de"));
  return { sources: views, summary };
}

export function nextTitle(currentTitle: string, sourceLabel: string, remoteLabel: string): string {
  if (remoteLabel.includes("unbekannt")) return currentTitle;
  return currentTitle.startsWith(sourceLabel) ? `${sourceLabel}, ${remoteLabel}` : currentTitle;
}
