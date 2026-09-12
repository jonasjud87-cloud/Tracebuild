"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { Organization, OrgCost, PlanTier, OrgStatus } from "./types";
import { fmtMonth } from "./mockCosts";

interface Props {
  org: Organization | null;
  costs: OrgCost[];
  onClose: () => void;
  onEdit: () => void;
  onToast: (msg: string, type: "success" | "error" | "warning" | "info") => void;
}

type Tab = "uebersicht" | "mitglieder" | "auditlog" | "projekte" | "nutzung" | "kosten" | "einstellungen";

const TAB_LABELS: { id: Tab; label: string }[] = [
  { id: "uebersicht",     label: "Übersicht"     },
  { id: "mitglieder",    label: "Mitglieder"    },
  { id: "auditlog",      label: "Audit-Log"      },
  { id: "projekte",      label: "Projekte"       },
  { id: "nutzung",       label: "Nutzung"        },
  { id: "kosten",        label: "Kosten"         },
  { id: "einstellungen", label: "Einstellungen"  },
];

interface AuditLogEntry {
  id: string;
  actor_email: string;
  action:
    | "invite" | "reinvite" | "role_change" | "remove"
    | "project_create" | "project_delete" | "project_update"
    | "project_member_add" | "project_member_remove"
    | "org_create" | "org_update" | "org_delete" | "org_status_change"
    | "norm_delete" | "norm_promote" | "norm_upload_platform"
    | "norm_upload" | "norm_remove" | "norm_custom_create"
    | "norm_refresh" | "project_norm_add" | "project_norm_remove"
    | "analysis_run" | "analysis_delete" | "chat_message";
  target_id: string | null;
  target_email: string | null;
  meta: Record<string, unknown>;
  created_at: string;
}

interface OrgMember {
  id: string;
  email: string;
  name: string | null;
  role: string;
  created_at: string;
}

const MOCK_PROJECTS: Record<string, { name: string; status: string; created: string; analyses: number }[]> = {
  "tracebuild-default": [
    { name: "Neubau Wohnhaus Tessin",   status: "active",   created: "2024-06-01", analyses: 23 },
    { name: "Sanierung Schulhaus ZH",   status: "active",   created: "2024-08-15", analyses: 41 },
    { name: "Industriehalle Winterthur",status: "archived", created: "2024-03-10", analyses: 18 },
    { name: "Bürokomplex Zürich-West",  status: "active",   created: "2024-11-01", analyses: 37 },
    { name: "Mehrfamilienhaus Bern",    status: "active",   created: "2025-01-20", analyses: 28 },
  ],
  "org-mueller": [
    { name: "Wohnhaus Rüschlikon",  status: "active",   created: "2024-04-01", analyses: 52 },
    { name: "Gewerbehaus Schlieren",status: "active",   created: "2024-06-15", analyses: 61 },
    { name: "Umbau Villa Horgen",   status: "archived", created: "2024-05-01", analyses: 29 },
    { name: "Neubau Enge",          status: "active",   created: "2026-07-26", analyses: 4  },
  ],
  "org-hochbau-zh": [
    { name: "Schulhaus Erweiterung Winterthur", status: "active",   created: "2026-07-22", analyses: 12 },
    { name: "Verwaltungsgebäude Zürich",         status: "active",   created: "2024-07-01", analyses: 88 },
    { name: "Sporthalle Dietikon",               status: "active",   created: "2024-09-01", analyses: 73 },
    { name: "Kindergarten Uster",                status: "archived", created: "2024-06-01", analyses: 45 },
    { name: "Hallenbad Oetwil",                  status: "active",   created: "2025-02-01", analyses: 61 },
  ],
};

function getProjects(orgId: string) {
  return MOCK_PROJECTS[orgId] ?? [{ name: "Beispielprojekt", status: "active", created: "2024-01-01", analyses: 0 }];
}

function Initials({ name, size = "sm" }: { name: string; size?: "sm" | "md" }) {
  const init = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  const cls = size === "md" ? "w-9 h-9 text-sm" : "w-7 h-7 text-[10px]";
  return (
    <div className={`${cls} rounded-lg bg-[#2862D7]/10 flex items-center justify-center flex-shrink-0 font-bold text-[#85A6E9]`}>
      {init}
    </div>
  );
}

const planLabel: Record<PlanTier, string> = { starter: "Starter", business: "Business", enterprise: "Enterprise" };
const planCls: Record<PlanTier, string> = {
  starter:    "bg-[rgba(60,63,68,0.5)] text-[#ABAEBB]",
  business:   "bg-sky-500/15 text-sky-400",
  enterprise: "bg-[#2862D7]/10 text-[#85A6E9]",
};
type StatusMeta = { dot: string; text: string; label: string };
const statusMeta: Record<OrgStatus, StatusMeta> = {
  active:   { dot: "bg-emerald-500", text: "text-emerald-400", label: "Aktiv"       },
  paused:   { dot: "bg-amber-400",   text: "text-amber-400",   label: "Pausiert"    },
  closed:   { dot: "bg-[#4B5563]",   text: "text-[#ABAEBB]",   label: "Geschlossen" },
  archived: { dot: "bg-[#374151]",   text: "text-[#7B8299]",   label: "Archiviert"  },
};

function chf(n: number): string { return `CHF ${n.toFixed(2)}`; }

// ────────────────────────────────────────────────────────────────────────────

function UebersichtTab({ org, costs }: { org: Organization; costs: OrgCost[] }) {
  const currentCost = costs
    .filter(c => c.orgId === org.id)
    .sort((a, b) => b.month.localeCompare(a.month))[0];
  const sm = statusMeta[org.status];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${sm.text}`}>
          <span className={`w-2 h-2 rounded-full ${sm.dot}`} />
          {sm.label}
        </span>
        <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wide ${planCls[org.planTier]}`}>
          {planLabel[org.planTier]}
        </span>
        {org.isDefault && (
          <span className="text-[9px] font-bold text-[#85A6E9] bg-[#2862D7]/10 px-1.5 py-0.5 rounded uppercase tracking-wider">
            Default
          </span>
        )}
      </div>

      {org.description && <p className="text-sm text-[#ABAEBB]">{org.description}</p>}

      {(org.owner || org.ownerEmail) && (
        <div className="flex items-center gap-3 bg-[#172540] rounded-xl px-4 py-3">
          <Initials name={org.owner ?? org.name} size="md" />
          <div>
            {org.owner && <p className="text-sm font-medium text-white">{org.owner}</p>}
            {org.ownerEmail && <p className="text-xs text-[#7B8299]">{org.ownerEmail}</p>}
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3">
        {[
          { label: "Benutzer",     value: org.userCount?.toString()    ?? "—" },
          { label: "Projekte",     value: org.projectCount?.toString() ?? "—" },
          { label: "Analysen",     value: org.analyseCount?.toString() ?? "—" },
          { label: "Speicher",     value: org.storageGB !== undefined ? `${org.storageGB} GB` : "—" },
          { label: "Budget/Monat", value: org.monthlyBudget !== undefined ? chf(org.monthlyBudget) : "—" },
          { label: "Kosten/Monat", value: currentCost ? chf(currentCost.totalCost) : "—" },
        ].map(stat => (
          <div key={stat.label} className="bg-[#172540] rounded-xl px-4 py-3">
            <p className="text-[10px] font-semibold text-[#7B8299] uppercase tracking-widest">{stat.label}</p>
            <p className="text-base font-bold text-white mt-0.5">{stat.value}</p>
          </div>
        ))}
      </div>

      <div className="text-xs text-[#7B8299] space-y-1">
        <p>Erstellt: {new Date(org.createdAt).toLocaleDateString("de-CH", { day: "numeric", month: "long", year: "numeric" })}</p>
        {currentCost && <p>Aktueller Monat: {fmtMonth(currentCost.month)} ({currentCost.status})</p>}
      </div>
    </div>
  );
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin", org_admin: "Admin",
  project_manager: "Manager", member: "Mitglied",
};

function ConfirmModal({
  title, description, confirmLabel, onConfirm, onClose,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#0E111B] rounded-2xl shadow-2xl w-full max-w-sm p-7 border border-[rgba(60,63,68,0.5)]">
        <h3 className="text-base font-bold text-white text-center mb-2">{title}</h3>
        <p className="text-sm text-[#ABAEBB] text-center mb-6">{description}</p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border border-[rgba(60,63,68,0.4)] rounded-xl py-2.5 text-sm font-medium text-[#ABAEBB] hover:bg-[#1E2D4A] transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold bg-red-600 text-white hover:bg-red-700 active:scale-[0.97] transition-all"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function MitgliederTab({
  org,
  onToast,
}: {
  org: Organization;
  onToast: (msg: string, type: "success" | "error" | "warning" | "info") => void;
}) {
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState("member");
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<OrgMember | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/orgs/${org.id}/users`);
      const json = await res.json().catch(() => null);
      setMembers(json?.data ?? []);
    } catch {
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [org.id]);

  useEffect(() => { load(); }, [load]);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    const name = addName.trim().replace(/\s+/g, " ");
    if (!addEmail.trim()) return;
    if (name.length < 2) { onToast("Bitte den Namen der Person angeben.", "error"); return; }
    setAdding(true);
    try {
      const res = await fetch("/api/v1/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, email: addEmail.trim().toLowerCase(), role: addRole, org_id: org.id }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && !json?.error) {
        onToast("Einladung gesendet.", "success");
        setAddName("");
        setAddEmail("");
        await load();
      } else {
        onToast(json?.error ?? "Fehler.", "error");
      }
    } catch {
      onToast("Netzwerkfehler — Einladung nicht gesendet.", "error");
    } finally {
      setAdding(false);
    }
  }

  async function handleRoleChange(m: OrgMember, role: string) {
    setSavingRoleId(m.id);
    try {
      const res = await fetch(`/api/v1/admin/orgs/${org.id}/users`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: m.id, role }),
      });
      const json = await res.json().catch(() => null);
      if (res.ok && !json?.error) {
        setMembers(prev => prev.map(x => x.id === m.id ? { ...x, role } : x));
        onToast("Rolle aktualisiert.", "success");
      } else {
        onToast(json?.error ?? "Fehler.", "error");
      }
    } catch {
      onToast("Netzwerkfehler — Rolle nicht aktualisiert.", "error");
    } finally {
      setSavingRoleId(null);
    }
  }

  async function handleRemove(m: OrgMember) {
    setRemovingId(m.id);
    const res = await fetch(`/api/v1/admin/orgs/${org.id}/users`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId: m.id }),
    });
    const json = await res.json();
    if (res.ok) {
      onToast(`${m.email} entfernt.`, "info");
      await load();
    } else {
      onToast(json.error ?? "Fehler.", "error");
    }
    setRemovingId(null);
  }

  const iCls = [
    "rounded-xl px-3 py-2 text-sm text-white",
    "bg-[rgba(23,37,64,0.6)] border border-[rgba(133,166,233,0.25)]",
    "placeholder:text-[#7B8299] focus:outline-none focus:ring-2 focus:ring-[#2862D7]/40 focus:border-[#2862D7]",
    "transition-colors",
  ].join(" ");

  return (
    <div className="space-y-4">
      <form onSubmit={handleAdd} className="flex gap-2 flex-wrap">
        <input
          type="text" required placeholder="Name"
          value={addName} onChange={e => setAddName(e.target.value)}
          className={`${iCls} flex-1 min-w-[150px]`}
        />
        <input
          type="email" required placeholder="E-Mail des Benutzers"
          value={addEmail} onChange={e => setAddEmail(e.target.value)}
          className={`${iCls} flex-1 min-w-[180px]`}
        />
        <select
          value={addRole} onChange={e => setAddRole(e.target.value)}
          className={`${iCls} flex-shrink-0`}
        >
          <option value="member">Mitglied</option>
          <option value="project_manager">Manager</option>
          <option value="org_admin">Admin</option>
        </select>
        <button
          type="submit" disabled={adding}
          className="flex-shrink-0 bg-[#2862D7] hover:bg-[#3470E8] disabled:opacity-50 text-white text-sm font-semibold px-4 py-2 rounded-xl transition-colors"
        >
          {adding ? "..." : "Hinzufügen"}
        </button>
      </form>

      {loading ? (
        <div className="py-8 text-center text-[#7B8299] text-sm">Lade Mitglieder…</div>
      ) : members.length === 0 ? (
        <div className="py-8 text-center text-[#7B8299] text-sm">Noch keine Mitglieder.</div>
      ) : (
        <div>
          <p className="text-xs text-[#7B8299] mb-3">{members.length} Mitglieder</p>
          {members.map(m => (
            <div key={m.id} className="flex items-center gap-3 py-2.5 border-b border-[rgba(60,63,68,0.3)] last:border-0">
              <Initials name={m.name || m.email} size="md" />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-white truncate">{m.name || m.email}</p>
                <p className="text-xs text-[#7B8299] truncate">
                  {m.name ? `${m.email} · ` : ""}{new Date(m.created_at).toLocaleDateString("de-CH")}
                </p>
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <select
                  value={m.role}
                  onChange={e => handleRoleChange(m, e.target.value)}
                  disabled={savingRoleId === m.id}
                  className={`text-[10px] font-semibold pl-2 pr-1 py-0.5 rounded-full border-0 focus:outline-none focus:ring-2 focus:ring-[#2862D7]/40 transition-colors disabled:opacity-50 ${
                    m.role === "org_admin" || m.role === "super_admin"
                      ? "bg-[#2862D7]/10 text-[#85A6E9]"
                      : "bg-[rgba(60,63,68,0.5)] text-[#ABAEBB]"
                  }`}
                >
                  {(["member", "project_manager", "org_admin"] as const).map(r => (
                    <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                  ))}
                </select>
                <button
                  onClick={() => setConfirmRemove(m)}
                  disabled={removingId === m.id}
                  className="w-6 h-6 flex items-center justify-center text-[#7B8299] hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors disabled:opacity-40"
                  title="Entfernen"
                >
                  <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                    <path d="M1.5 1.5L9.5 9.5M9.5 1.5L1.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {confirmRemove && (
        <ConfirmModal
          title="Mitglied entfernen"
          description={`${confirmRemove.email} wird aus der Organisation entfernt und kann sich danach nicht mehr anmelden.`}
          confirmLabel="Entfernen"
          onConfirm={() => { handleRemove(confirmRemove); setConfirmRemove(null); }}
          onClose={() => setConfirmRemove(null)}
        />
      )}
    </div>
  );
}

const AUDIT_ACTION_LABELS: Record<AuditLogEntry["action"], string> = {
  invite: "Eingeladen",
  reinvite: "Erneut eingeladen",
  role_change: "Rolle geändert",
  remove: "Entfernt",
  project_create: "Projekt erstellt",
  project_delete: "Projekt gelöscht",
  project_update: "Projekt geändert",
  project_member_add: "Mitglied zu Projekt hinzugefügt",
  project_member_remove: "Mitglied aus Projekt entfernt",
  org_create: "Organisation erstellt",
  org_update: "Organisation geändert",
  org_delete: "Organisation gelöscht",
  org_status_change: "Status geändert",
  norm_delete: "Norm gelöscht",
  norm_promote: "Norm plattformweit gemacht",
  norm_upload_platform: "Plattform-Norm hochgeladen",
  norm_upload: "Norm hochgeladen",
  norm_remove: "Norm entfernt",
  norm_custom_create: "Eigene Norm erstellt",
  norm_refresh: "Normen aktualisiert",
  project_norm_add: "Norm zu Projekt hinzugefügt",
  project_norm_remove: "Norm von Projekt entfernt",
  analysis_run: "Analyse durchgeführt",
  analysis_delete: "Analyse gelöscht",
  chat_message: "Chat-Nachricht gesendet",
};

function auditDetails(e: AuditLogEntry): string {
  if (e.action === "role_change") {
    const r = e.meta?.newRole;
    return typeof r === "string" ? (ROLE_LABELS[r] ?? r) : "—";
  }
  if (e.action === "invite" || e.action === "reinvite") {
    const r = e.meta?.role;
    return typeof r === "string" ? (ROLE_LABELS[r] ?? r) : "—";
  }
  if (e.action === "project_create" || e.action === "project_delete") {
    const n = e.meta?.name;
    return typeof n === "string" ? n : "—";
  }
  if (e.action === "org_update" || e.action === "project_update") {
    return Array.isArray(e.meta?.fields) ? (e.meta.fields as string[]).join(", ") : "—";
  }
  if (e.action === "org_status_change") {
    const s = e.meta?.status;
    return typeof s === "string" ? s : "—";
  }
  if (e.action === "norm_delete" || e.action === "norm_upload_platform" || e.action === "norm_upload" || e.action === "norm_custom_create") {
    const t = e.meta?.title;
    return typeof t === "string" ? t : "—";
  }
  if (e.action === "analysis_run") {
    if (e.meta?.status === "error") return `Fehler: ${e.meta?.error}`;
    const s = e.meta?.status;
    return typeof s === "string" ? s : "—";
  }
  return "";
}

type AuditSortKey = "created_at" | "actor_email" | "action";

function SortIndicator({ active, dir }: { active: boolean; dir: "asc" | "desc" }) {
  if (!active) return null;
  return <span className="ml-1 text-[9px]">{dir === "asc" ? "▲" : "▼"}</span>;
}

function AuditLogTab({ org }: { org: Organization }) {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sort, setSort] = useState<{ key: AuditSortKey; dir: "asc" | "desc" }>({ key: "created_at", dir: "desc" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/orgs/${org.id}/audit-log`);
      const json = await res.json().catch(() => null);
      if (res.ok && !json?.error) {
        setEntries(json?.data ?? []);
        setLoadError(null);
      } else {
        setEntries([]);
        setLoadError(json?.error ?? "Audit-Log konnte nicht geladen werden.");
      }
    } catch {
      setEntries([]);
      setLoadError("Netzwerkfehler — Audit-Log konnte nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, [org.id]);

  useEffect(() => { load(); }, [load]);

  function toggleSort(key: AuditSortKey) {
    setSort(prev => prev.key === key ? { key, dir: prev.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" });
  }

  const sorted = [...entries].sort((a, b) => {
    let cmp = 0;
    if (sort.key === "created_at") cmp = a.created_at.localeCompare(b.created_at);
    else if (sort.key === "actor_email") cmp = a.actor_email.localeCompare(b.actor_email);
    else cmp = a.action.localeCompare(b.action);
    return sort.dir === "asc" ? cmp : -cmp;
  });

  const thCls = "text-left text-[10px] font-semibold text-[#7B8299] uppercase tracking-widest px-3 py-2 cursor-pointer select-none whitespace-nowrap";

  return (
    <div className="space-y-4">
      {loading ? (
        <div className="py-8 text-center text-[#7B8299] text-sm">Lade Einträge…</div>
      ) : loadError ? (
        <div className="py-8 text-center text-sm text-red-400">{loadError}</div>
      ) : entries.length === 0 ? (
        <div className="py-8 text-center text-[#7B8299] text-sm">Noch keine Einträge.</div>
      ) : (
        <div className="overflow-x-auto scrollbar-dark">
          <table className="w-full border-collapse">
            <thead>
              <tr className="border-b border-[rgba(60,63,68,0.4)]">
                <th className={thCls} onClick={() => toggleSort("created_at")}>
                  Zeitpunkt<SortIndicator active={sort.key === "created_at"} dir={sort.dir} />
                </th>
                <th className={thCls} onClick={() => toggleSort("actor_email")}>
                  Wer<SortIndicator active={sort.key === "actor_email"} dir={sort.dir} />
                </th>
                <th className={thCls} onClick={() => toggleSort("action")}>
                  Aktion<SortIndicator active={sort.key === "action"} dir={sort.dir} />
                </th>
                <th className={thCls}>Ziel</th>
                <th className={thCls}>Details</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(e => (
                <tr key={e.id} className="border-b border-[rgba(60,63,68,0.3)] last:border-0">
                  <td className="px-3 py-2.5 text-xs text-[#ABAEBB] whitespace-nowrap">
                    {new Date(e.created_at).toLocaleString("de-CH", { dateStyle: "medium", timeStyle: "short" })}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-white truncate max-w-[160px]">{e.actor_email}</td>
                  <td className="px-3 py-2.5 text-sm text-white whitespace-nowrap">{AUDIT_ACTION_LABELS[e.action]}</td>
                  <td className="px-3 py-2.5 text-xs text-[#7B8299] truncate max-w-[160px]">{e.target_email ?? "—"}</td>
                  <td className="px-3 py-2.5 text-xs text-[#7B8299] whitespace-nowrap">{auditDetails(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProjekteTab({ org }: { org: Organization }) {
  const projects = getProjects(org.id);
  return (
    <div className="space-y-2">
      <p className="text-xs text-[#7B8299] mb-3">{projects.length} Projekte</p>
      {projects.map(p => (
        <div key={p.name} className="flex items-start gap-3 py-2.5 border-b border-[rgba(60,63,68,0.3)] last:border-0">
          <div className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${p.status === "active" ? "bg-emerald-500" : "bg-[rgba(60,63,68,0.5)]"}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-white truncate">{p.name}</p>
            <p className="text-xs text-[#7B8299]">Erstellt: {new Date(p.created).toLocaleDateString("de-CH")}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xs font-medium text-[#ABAEBB]">{p.analyses} Analysen</p>
            <p className={`text-[10px] ${p.status === "active" ? "text-emerald-400" : "text-[#7B8299]"}`}>
              {p.status === "active" ? "Aktiv" : "Archiviert"}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

function NutzungTab({ org, costs }: { org: Organization; costs: OrgCost[] }) {
  const orgCosts = costs.filter(c => c.orgId === org.id).sort((a, b) => a.month.localeCompare(b.month));
  const maxAnalyse = Math.max(...orgCosts.map(c => c.analyseCount), 1);
  const totalStorageMax = 50;
  const storagePct = Math.min(((org.storageGB ?? 0) / totalStorageMax) * 100, 100);

  return (
    <div className="space-y-6">
      <div>
        <h5 className="text-xs font-semibold text-[#7B8299] uppercase tracking-widest mb-3">
          Analysen / Monat (letzte 6 Monate)
        </h5>
        {orgCosts.length === 0 ? (
          <p className="text-sm text-[#ABAEBB]">Keine Daten</p>
        ) : (
          <div className="space-y-2">
            {orgCosts.map(c => {
              const barPct = (c.analyseCount / maxAnalyse) * 100;
              const isCurrent = c.status === "laufend";
              return (
                <div key={c.month} className="flex items-center gap-3">
                  <span className="text-[11px] text-[#7B8299] w-14 flex-shrink-0">{fmtMonth(c.month)}</span>
                  <div className="flex-1 h-5 bg-[#172540] rounded-md overflow-hidden">
                    <div
                      className="h-full rounded-md"
                      style={{
                        width: `${barPct}%`,
                        backgroundColor: isCurrent ? "#2862D7" : "rgba(40,98,215,0.25)",
                      }}
                    />
                  </div>
                  <span className="text-[11px] font-medium text-[#ABAEBB] tabular-nums w-8 text-right flex-shrink-0">
                    {c.analyseCount}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div>
        <h5 className="text-xs font-semibold text-[#7B8299] uppercase tracking-widest mb-3">
          Speicherverbrauch
        </h5>
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-medium text-white">{org.storageGB ?? 0} GB belegt</span>
          <span className="text-xs text-[#7B8299]">von {totalStorageMax} GB</span>
        </div>
        <div className="h-3 bg-[#2862D7]/10 rounded-full overflow-hidden">
          <div
            className="h-full rounded-full transition-all"
            style={{ width: `${storagePct}%`, backgroundColor: storagePct >= 85 ? "#EF4444" : "#2862D7" }}
          />
        </div>
        <p className="text-[11px] text-[#7B8299] mt-1">{storagePct.toFixed(0)} % genutzt</p>
      </div>
    </div>
  );
}

function KostenTab({ org, costs }: { org: Organization; costs: OrgCost[] }) {
  const orgCosts = costs.filter(c => c.orgId === org.id).sort((a, b) => b.month.localeCompare(a.month)).slice(0, 3);
  const latestCost = orgCosts[0];
  const budgetPct = org.monthlyBudget && latestCost
    ? Math.min((latestCost.totalCost / org.monthlyBudget) * 100, 100)
    : 0;

  return (
    <div className="space-y-5">
      {org.monthlyBudget && latestCost && (
        <div className="bg-[#172540] rounded-xl p-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-xs font-semibold text-[#7B8299] uppercase tracking-widest">
              Budget {fmtMonth(latestCost.month)}
            </span>
            <span className={`text-xs font-semibold ${budgetPct >= 90 ? "text-red-400" : budgetPct >= 70 ? "text-amber-400" : "text-[#85A6E9]"}`}>
              {chf(latestCost.totalCost)} / {chf(org.monthlyBudget)}
            </span>
          </div>
          <div className="h-2.5 bg-[#2862D7]/10 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full"
              style={{
                width: `${budgetPct}%`,
                backgroundColor: budgetPct >= 90 ? "#EF4444" : budgetPct >= 70 ? "#F59E0B" : "#2862D7",
              }}
            />
          </div>
          <p className="text-[11px] text-[#7B8299] mt-1">{budgetPct.toFixed(0)} % verbraucht</p>
        </div>
      )}

      <div>
        <h5 className="text-xs font-semibold text-[#7B8299] uppercase tracking-widest mb-3">Letzte 3 Monate</h5>
        {orgCosts.length === 0 ? (
          <p className="text-sm text-[#ABAEBB]">Keine Kostendaten vorhanden</p>
        ) : (
          <div className="space-y-2">
            {orgCosts.map(c => (
              <div key={c.month} className="bg-[#172540] rounded-xl px-4 py-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-sm font-medium text-white">{fmtMonth(c.month)}</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
                      c.status === "laufend" ? "bg-amber-500/15 text-amber-400" : "bg-emerald-500/15 text-emerald-400"
                    }`}>
                      {c.status === "laufend" ? "Laufend" : "Final"}
                    </span>
                    <span className="text-sm font-bold text-white tabular-nums">{chf(c.totalCost)}</span>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 text-[11px] text-[#7B8299]">
                  <span>{c.analyseCount} Analysen</span>
                  <span>Ø {chf(c.analyseCount > 0 ? c.totalCost / c.analyseCount : 0)}</span>
                  <span>{c.storageGB} GB Storage</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function EinstellungenTab({
  org, onToast,
}: {
  org: Organization;
  onToast: (msg: string, type: "success" | "error" | "warning" | "info") => void;
}) {
  const [name, setName]             = useState(org.name);
  const [description, setDesc]      = useState(org.description ?? "");
  const [owner, setOwner]           = useState(org.owner ?? "");
  const [ownerEmail, setOwnerEmail] = useState(org.ownerEmail ?? "");
  const [budget, setBudget]         = useState(org.monthlyBudget?.toString() ?? "");

  useEffect(() => {
    setName(org.name);
    setDesc(org.description ?? "");
    setOwner(org.owner ?? "");
    setOwnerEmail(org.ownerEmail ?? "");
    setBudget(org.monthlyBudget?.toString() ?? "");
  }, [org]);

  function handleSave() {
    if (!name.trim()) { onToast("Name darf nicht leer sein.", "error"); return; }
    onToast(`${name} wurde gespeichert.`, "success");
  }

  const iCls = [
    "w-full rounded-xl px-3.5 py-2.5 text-sm text-white",
    "bg-[rgba(23,37,64,0.6)] border border-[rgba(133,166,233,0.25)]",
    "placeholder:text-[#7B8299]",
    "focus:outline-none focus:ring-2 focus:ring-[#2862D7]/40 focus:border-[#2862D7]",
    "transition-colors",
  ].join(" ");

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs font-medium text-[#7B8299] mb-1.5">Organisationsname *</label>
        <input value={name} onChange={e => setName(e.target.value)} className={iCls} />
      </div>
      <div>
        <label className="block text-xs font-medium text-[#7B8299] mb-1.5">Kurzbeschreibung</label>
        <input value={description} onChange={e => setDesc(e.target.value)} placeholder="Kurze Beschreibung" className={iCls} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-[#7B8299] mb-1.5">Besitzer</label>
          <input value={owner} onChange={e => setOwner(e.target.value)} placeholder="Name" className={iCls} />
        </div>
        <div>
          <label className="block text-xs font-medium text-[#7B8299] mb-1.5">E-Mail</label>
          <input type="email" value={ownerEmail} onChange={e => setOwnerEmail(e.target.value)} placeholder="email@beispiel.ch" className={iCls} />
        </div>
      </div>
      <div>
        <label className="block text-xs font-medium text-[#7B8299] mb-1.5">Monatliches Budget (CHF)</label>
        <input
          type="number"
          min={0}
          value={budget}
          onChange={e => setBudget(e.target.value)}
          placeholder="—"
          className={iCls}
        />
      </div>
      <div className="pt-2">
        <button
          onClick={handleSave}
          className="w-full bg-[#2862D7] text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-[#3470E8] active:scale-[0.98] transition-all"
        >
          Einstellungen speichern
        </button>
      </div>
      {!org.isDefault && (
        <div className="pt-2 border-t border-[rgba(60,63,68,0.4)]">
          <p className="text-[11px] font-semibold text-[#7B8299] uppercase tracking-widest mb-2">Gefahrenzone</p>
          <button
            onClick={() => onToast("Bitte nutze die Aktionsmenü-Optionen zum Löschen.", "warning")}
            className="w-full border border-red-500/30 text-red-400 rounded-xl py-2 text-sm font-medium hover:bg-red-500/10 transition-colors"
          >
            Organisation löschen
          </button>
        </div>
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────

const PANEL_WIDTH_KEY = "tb_admin_panel_width";
const PANEL_WIDTH_DEFAULT = 760;
const PANEL_WIDTH_MIN = 480;
const PANEL_WIDTH_MAX = 1100;

function clampPanelWidth(w: number): number {
  const viewportCap = typeof window !== "undefined" ? window.innerWidth - 48 : PANEL_WIDTH_MAX;
  return Math.min(Math.max(w, PANEL_WIDTH_MIN), Math.min(PANEL_WIDTH_MAX, viewportCap));
}

export default function OrgDetailPanel({ org, costs, onClose, onEdit, onToast }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("uebersicht");
  const [panelWidth, setPanelWidthState] = useState(PANEL_WIDTH_DEFAULT);
  const widthRef = useRef(PANEL_WIDTH_DEFAULT);
  const resizing = useRef(false);
  const orgId = org?.id;

  function setPanelWidth(w: number) {
    widthRef.current = w;
    setPanelWidthState(w);
  }

  useEffect(() => { setActiveTab("uebersicht"); }, [orgId]);

  // Zuletzt gewählte Panel-Breite merken — pro Browser, nicht pro Org.
  useEffect(() => {
    try {
      const saved = Number(window.localStorage.getItem(PANEL_WIDTH_KEY));
      if (saved) setPanelWidth(clampPanelWidth(saved));
    } catch { /* z.B. privater Modus — Standardbreite bleibt */ }
  }, []);

  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!resizing.current) return;
      setPanelWidth(clampPanelWidth(window.innerWidth - e.clientX));
    }
    function onUp() {
      if (!resizing.current) return;
      resizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      try { window.localStorage.setItem(PANEL_WIDTH_KEY, String(widthRef.current)); } catch { /* best effort */ }
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, []);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    resizing.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  return (
    <>
      <div
        className={`fixed inset-0 z-40 bg-black/40 backdrop-blur-sm transition-opacity duration-300 ${
          org ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        onClick={onClose}
      />

      <div
        className={`fixed inset-y-0 right-0 z-50 w-full sm:w-[var(--tb-panel-w)] bg-[#0E111B] border-l border-[rgba(60,63,68,0.5)] shadow-2xl flex flex-col transform transition-transform duration-300 ${
          org ? "translate-x-0" : "translate-x-full"
        }`}
        style={{ "--tb-panel-w": `${panelWidth}px` } as React.CSSProperties}
      >
        <div
          onMouseDown={startResize}
          title="Breite anpassen"
          className="hidden sm:block absolute left-0 top-0 bottom-0 w-1.5 -translate-x-1/2 cursor-col-resize z-10 hover:bg-[#2862D7]/40 active:bg-[#2862D7]/60 transition-colors"
        />
        {org && (
          <>
            <div className="flex-shrink-0 px-6 py-5 border-b border-[rgba(60,63,68,0.4)]">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-10 h-10 rounded-xl bg-[#2862D7]/10 flex items-center justify-center flex-shrink-0">
                    <span className="text-sm font-bold text-[#85A6E9]">
                      {org.name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-base font-bold text-white truncate">{org.name}</h2>
                    <p className="text-xs text-[#7B8299] truncate">{org.ownerEmail ?? org.id}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <button
                    onClick={onEdit}
                    className="text-xs font-semibold text-[#85A6E9] bg-[#2862D7]/10 hover:bg-[#2862D7] hover:text-white px-3 py-1.5 rounded-lg transition-all"
                  >
                    Bearbeiten
                  </button>
                  <button
                    onClick={onClose}
                    className="w-7 h-7 flex items-center justify-center text-[#7B8299] hover:text-white hover:bg-[#1E2D4A] rounded-lg transition-colors"
                  >
                    <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                      <path d="M1.5 1.5L9.5 9.5M9.5 1.5L1.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>

              <div className="flex gap-1 mt-4 overflow-x-auto scrollbar-dark">
                {TAB_LABELS.map(t => (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id)}
                    className={`flex-shrink-0 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors whitespace-nowrap ${
                      activeTab === t.id
                        ? "bg-[#2862D7] text-white"
                        : "text-[#7B8299] hover:text-white hover:bg-[#172540]"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex-1 overflow-y-auto px-6 py-5 scrollbar-dark">
              {activeTab === "uebersicht"     && <UebersichtTab    org={org} costs={costs} />}
              {activeTab === "mitglieder"     && <MitgliederTab    org={org} onToast={onToast} />}
              {activeTab === "auditlog"       && <AuditLogTab      org={org} />}
              {activeTab === "projekte"       && <ProjekteTab      org={org} />}
              {activeTab === "nutzung"        && <NutzungTab       org={org} costs={costs} />}
              {activeTab === "kosten"         && <KostenTab        org={org} costs={costs} />}
              {activeTab === "einstellungen"  && <EinstellungenTab org={org} onToast={onToast} />}
            </div>
          </>
        )}
      </div>
    </>
  );
}
