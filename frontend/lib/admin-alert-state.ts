import type { AdminAlert } from "@/lib/admin-alerts";

export type AlertState = "archived" | "deleted";

export interface StoredAlertState {
  alert_id: string;
  state: AlertState;
  fingerprint: string;
}

export interface SplitAlerts {
  open: AdminAlert[];
  archived: AdminAlert[];
}

export function alertFingerprint(alert: Pick<AdminAlert, "rule" | "severity" | "title" | "message">): string {
  const base = `${alert.severity}|${alert.title}`;
  return alert.rule === "norm_watch" ? `${base}|${alert.message}` : base;
}

export function splitAlerts(alerts: AdminAlert[], states: StoredAlertState[]): SplitAlerts {
  const byId = new Map<string, StoredAlertState>();
  states.forEach(s => byId.set(s.alert_id, s));
  const open: AdminAlert[] = [];
  const archived: AdminAlert[] = [];
  alerts.forEach(a => {
    const s = byId.get(a.id);
    if (!s || s.fingerprint !== alertFingerprint(a)) {
      open.push(a);
    } else if (s.state === "archived") {
      archived.push(a);
    }
  });
  return { open, archived };
}

export function countAlerts(alerts: AdminAlert[]) {
  const counts = { critical: 0, warning: 0, info: 0, total: alerts.length };
  alerts.forEach(a => { counts[a.severity] += 1; });
  return counts;
}
