"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import AdminNav from "@/components/admin/AdminNav";
import OrgTable from "@/components/admin/OrgTable";
import OrgModal from "@/components/admin/OrgModal";
import type { OrgFormData } from "@/components/admin/OrgModal";
import OrgDetailPanel from "@/components/admin/OrgDetailPanel";
import InviteUserModal from "@/components/admin/InviteUserModal";
import type { SentInvite } from "@/components/admin/InviteUserModal";
import type { OrgUsersGroup } from "@/app/api/v1/admin/all-users/route";
import ActivityFeed from "@/components/admin/ActivityFeed";
import CostTable from "@/components/admin/CostTable";
import CostOverview from "@/components/admin/CostOverview";
import SystemStatus from "@/components/admin/SystemStatus";
import Toast from "@/components/admin/Toast";
import InvoicesSection from "@/components/admin/InvoicesSection";
import { currentMonth, fmtMonth, availableMonths, monthlyTotals, prevMonth } from "@/components/admin/mockCosts";
import { MOCK_ACTIVITIES } from "@/components/admin/mockOrgData";
import { organizationService } from "@/lib/services/organizationService";
import type {
  Organization,
  Activity,
  ActivityType,
  LastOpenedOrg,
  ToastMessage,
  SystemService,
  OrgCost,
} from "@/components/admin/types";

const ACTIVITY_KEY    = "tb_admin_activities";
const LAST_OPENED_KEY = "tb_admin_last_opened";

function loadActivities(): Activity[] {
  try {
    const raw = localStorage.getItem(ACTIVITY_KEY);
    const stored: Activity[] = raw ? (JSON.parse(raw) as Activity[]) : [];
    const storedIds = new Set(stored.map(a => a.id));
    const seedActivities = MOCK_ACTIVITIES.filter(a => !storedIds.has(a.id));
    return [...stored, ...seedActivities].slice(0, 50);
  } catch {
    return MOCK_ACTIVITIES;
  }
}

function loadLastOpened(): LastOpenedOrg | null {
  try {
    const raw = localStorage.getItem(LAST_OPENED_KEY);
    return raw ? (JSON.parse(raw) as LastOpenedOrg) : null;
  } catch {
    return null;
  }
}

function extractName(email: string, meta: Record<string, unknown> = {}): string {
  const full = ((meta.full_name ?? meta.name ?? "") as string).trim();
  if (full) return full.split(" ")[0];
  const prefix = email.split("@")[0].replace(/\d+$/, "");
  return prefix.charAt(0).toUpperCase() + prefix.slice(1);
}

function todayStr(): string {
  return new Date().toLocaleDateString("de-CH", {
    weekday: "long", day: "numeric", month: "long", year: "numeric",
  });
}

const ROLE_LABELS: Record<string, string> = {
  super_admin: "Super Admin", org_admin: "Admin",
  project_manager: "Manager", member: "Mitglied",
};

const TRACEBUILD_SEED: OrgFormData = {
  name:           "TraceBuild",
  description:    "TraceBuild Intern",
  planTier:       "enterprise",
  status:         "active",
  owner:          "TraceBuild Team",
  ownerEmail:     "tracebuild.info@gmail.com",
  userLimit:      null,
  projectLimit:   null,
  storageLimit:   null,
  monthlyBudget:  null,
};

function KpiCard({
  label, value, note, trend, accent,
}: {
  label: string;
  value: string;
  note?: string;
  trend?: { pct: string; positive: boolean };
  accent?: boolean;
}) {
  return (
    <div className={`bg-[#172540] border rounded-2xl p-4 flex flex-col ${accent ? "border-[#2862D7]/30" : "border-[rgba(60,63,68,0.5)]"}`}>
      <p className={`text-xl font-bold tracking-tight tabular-nums ${accent ? "text-[#85A6E9]" : "text-white"}`}>
        {value}
      </p>
      <p className="text-[10px] font-semibold text-[#7B8299] uppercase tracking-widest mt-1.5">{label}</p>
      <div className="flex items-center gap-2 mt-1">
        {trend && (
          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${
            trend.positive ? "bg-emerald-500/15 text-emerald-400" : "bg-red-500/15 text-red-400"
          }`}>
            {trend.pct}
          </span>
        )}
        {note && <p className="text-[10px] text-[#7B8299]">{note}</p>}
      </div>
    </div>
  );
}

function SearchInput({
  value, onChange, placeholder, id,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  id?: string;
}) {
  return (
    <div className="relative">
      <svg
        className="absolute left-3 top-1/2 -translate-y-1/2 text-[#7B8299] pointer-events-none"
        width="13" height="13" viewBox="0 0 13 13" fill="none"
      >
        <circle cx="5.5" cy="5.5" r="4" stroke="currentColor" strokeWidth="1.3" />
        <path d="M9 9L11.5 11.5" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
      </svg>
      <input
        id={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder ?? "Suchen..."}
        className="w-full pl-8 pr-8 py-2.5 text-sm border border-[rgba(133,166,233,0.25)] rounded-xl bg-[rgba(23,37,64,0.6)] text-white focus:outline-none focus:ring-2 focus:ring-[#2862D7]/40 focus:border-[#2862D7] transition-colors placeholder:text-[#7B8299]"
      />
      {value && (
        <button
          onClick={() => onChange("")}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[#7B8299] hover:text-white transition-colors"
        >
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
            <path d="M1.5 1.5L9.5 9.5M9.5 1.5L1.5 9.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

function SectionHeader({ title }: { title: string }) {
  return (
    <div className="flex items-center gap-3">
      <div className="h-px flex-1 bg-[rgba(60,63,68,0.4)]" />
      <span className="text-[10px] font-semibold text-[#7B8299] uppercase tracking-widest px-2">{title}</span>
      <div className="h-px flex-1 bg-[rgba(60,63,68,0.4)]" />
    </div>
  );
}

function ConfirmModal({
  orgName, title, description, confirmLabel, confirmCls,
  onConfirm, onClose,
}: {
  orgName: string;
  title: string;
  description: string;
  confirmLabel: string;
  confirmCls: string;
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
        <p className="text-sm text-[#ABAEBB] text-center mb-6">
          <span className="font-semibold text-white">{orgName}</span> {description}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border border-[rgba(60,63,68,0.4)] rounded-xl py-2.5 text-sm font-medium text-[#ABAEBB] hover:bg-[#1E2D4A] transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={onConfirm}
            className={`flex-1 rounded-xl py-2.5 text-sm font-semibold active:scale-[0.97] transition-all ${confirmCls}`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function QuickActionBtn({ icon, label, onClick }: { icon: ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex-1 flex flex-col items-center gap-2 py-4 px-3 bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl hover:border-[#2862D7]/40 hover:bg-[#2862D7]/8 transition-all text-center group"
    >
      <span className="text-[#7B8299] group-hover:text-[#85A6E9] transition-colors">{icon}</span>
      <span className="text-xs font-medium text-[#ABAEBB] group-hover:text-white transition-colors leading-tight">{label}</span>
    </button>
  );
}

export default function AdminPage() {
  const router = useRouter();

  const [userName, setUserName]   = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [orgs, setOrgs]           = useState<Organization[]>([]);
  const [hydrated, setHydrated]   = useState(false);
  const [seeding, setSeeding]     = useState(false);
  const [search, setSearch]       = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editTarget, setEditTarget]       = useState<Organization | null>(null);
  const [deleteTarget, setDeleteTarget]   = useState<Organization | null>(null);
  const [detailOrg, setDetailOrg]         = useState<Organization | null>(null);
  const [pauseTarget, setPauseTarget]     = useState<Organization | null>(null);
  const [closeTarget, setCloseTarget]     = useState<Organization | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Organization | null>(null);
  const [inviteModalOpen, setInviteModalOpen] = useState(false);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [lastOpened, setLastOpened] = useState<LastOpenedOrg | null>(null);
  const [costMonth, setCostMonth]   = useState(currentMonth);
  const [costSearch, setCostSearch] = useState("");
  const [toasts, setToasts]         = useState<ToastMessage[]>([]);
  const [systemServices, setSystemServices]   = useState<SystemService[]>([]);
  const [systemCheckedAt, setSystemCheckedAt] = useState<string | null>(null);
  const [systemLoading, setSystemLoading]     = useState(false);
  const [userGroups, setUserGroups]           = useState<OrgUsersGroup[]>([]);
  const [usersLoading, setUsersLoading]       = useState(false);
  const [userSearch, setUserSearch]           = useState("");
  const [resendingId, setResendingId]         = useState<string | null>(null);
  const [costs, setCosts]                     = useState<OrgCost[]>([]);
  const [costsLoading, setCostsLoading]       = useState(false);

  function addToast(message: string, type: ToastMessage["type"] = "success") {
    const id = crypto.randomUUID();
    setToasts(prev => [...prev.slice(-3), { id, message, type }]);
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000);
  }

  /* Load current user info */
  useEffect(() => {
    createClient().auth.getUser().then(({ data }) => {
      if (!data.user) return;
      const email = data.user.email ?? "";
      setUserEmail(email);
      setUserName(extractName(email, data.user.user_metadata ?? {}));
    });
  }, []);

  /* Load live system status */
  const loadSystemStatus = useCallback(async () => {
    setSystemLoading(true);
    try {
      const res = await fetch("/api/v1/admin/system-status");
      const json = await res.json() as { data: { services: SystemService[]; checkedAt: string } | null; error: string | null };
      if (json.data) {
        setSystemServices(json.data.services);
        setSystemCheckedAt(json.data.checkedAt);
      }
    } catch {
      /* keep previous state */
    } finally {
      setSystemLoading(false);
    }
  }, []);

  useEffect(() => { loadSystemStatus(); }, [loadSystemStatus]);

  /* Load all users across all orgs */
  const loadAllUsers = useCallback(async () => {
    setUsersLoading(true);
    try {
      const res = await fetch("/api/v1/admin/all-users");
      const json = await res.json() as { data: OrgUsersGroup[] | null; error: string | null };
      if (json.data) setUserGroups(json.data);
    } catch {
      /* keep previous state */
    } finally {
      setUsersLoading(false);
    }
  }, []);

  useEffect(() => { loadAllUsers(); }, [loadAllUsers]);

  /* Load real Claude analysis costs, aggregated per org per month */
  const loadCosts = useCallback(async () => {
    setCostsLoading(true);
    try {
      const res = await fetch("/api/v1/admin/costs");
      const json = await res.json() as { data: OrgCost[] | null; error: string | null };
      if (json.data) setCosts(json.data);
    } catch {
      /* keep previous state */
    } finally {
      setCostsLoading(false);
    }
  }, []);

  useEffect(() => { loadCosts(); }, [loadCosts]);

  async function resendInvite(orgId: string, email: string, role: string, name: string | null) {
    setResendingId(`${orgId}:${email}`);
    try {
      const res = await fetch("/api/v1/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, name: name ?? "", role, org_id: orgId }),
      });
      const json = await res.json().catch(() => null) as { data: unknown; error: string | null } | null;
      if (!res.ok || !json || json.error) {
        addToast(json?.error ?? "Einladung konnte nicht erneut gesendet werden.", "error");
      } else {
        addToast(`Einladung erneut an ${email} gesendet.`, "success");
        await loadAllUsers();
      }
    } catch {
      addToast("Einladung konnte nicht erneut gesendet werden.", "error");
    } finally {
      setResendingId(null);
    }
  }

  /* Load orgs — auto-seed TraceBuild if none exist */
  useEffect(() => {
    organizationService.list()
      .then(async data => {
        if (data.length === 0 && !seeding) {
          setSeeding(true);
          try {
            const tb = await organizationService.create(TRACEBUILD_SEED, true);
            setOrgs([tb]);
            addToast("TraceBuild Organisation wurde erstellt.", "success");
          } catch {
            addToast("Fehler beim Erstellen der TraceBuild Organisation.", "error");
          } finally {
            setSeeding(false);
          }
        } else {
          setOrgs(sortOrgs(data));
        }
      })
      .catch(() => { /* keep empty list */ })
      .finally(() => setHydrated(true));
    setActivities(loadActivities());
    setLastOpened(loadLastOpened());
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function sortOrgs(list: Organization[]): Organization[] {
    return [...list.filter(o => o.isDefault), ...list.filter(o => !o.isDefault)];
  }

  function trackActivity(type: ActivityType, orgName: string, orgId: string, meta?: string) {
    const entry: Activity = {
      id: crypto.randomUUID(), type, orgName, orgId,
      user: userEmail || undefined,
      timestamp: new Date().toISOString(), meta,
    };
    setActivities(prev => {
      const updated = [entry, ...prev].slice(0, 50);
      localStorage.setItem(ACTIVITY_KEY, JSON.stringify(
        updated.filter(a => !MOCK_ACTIVITIES.some(m => m.id === a.id))
      ));
      return updated;
    });
  }

  function handleOpen(org: Organization) {
    document.cookie = `tb_active_org_id=${org.id}; Path=/; Max-Age=86400; SameSite=Lax`;
    const lo: LastOpenedOrg = { id: org.id, name: org.name, planTier: org.planTier, timestamp: new Date().toISOString() };
    setLastOpened(lo);
    localStorage.setItem(LAST_OPENED_KEY, JSON.stringify(lo));
    trackActivity("org_opened", org.name, org.id);
    router.push("/dashboard");
  }

  async function handleSave(data: OrgFormData) {
    const isEdit   = !!editTarget;
    const targetId = editTarget?.id;
    try {
      if (isEdit && targetId) {
        const updated = await organizationService.update(targetId, data);
        setOrgs(prev => sortOrgs(prev.map(o => o.id === targetId ? updated : o)));
        trackActivity("org_edited", data.name, targetId);
        if (data.planTier !== editTarget?.planTier) {
          trackActivity("plan_changed", data.name, targetId, `${editTarget?.planTier} → ${data.planTier}`);
        }
        addToast(`${data.name} wurde gespeichert.`, "success");
      } else {
        const newOrg = await organizationService.create(data);
        setOrgs(prev => sortOrgs([...prev, newOrg]));
        trackActivity("org_created", data.name, newOrg.id);
        addToast(`${data.name} wurde erstellt.`, "success");
      }
    } catch {
      addToast("Fehler beim Speichern. Bitte versuche es erneut.", "error");
    } finally {
      setModalOpen(false);
      setEditTarget(null);
    }
  }

  async function handleDelete(org: Organization) {
    try {
      await organizationService.softDelete(org.id);
      setOrgs(prev => prev.filter(o => o.id !== org.id));
      if (detailOrg?.id === org.id) setDetailOrg(null);
      addToast(`${org.name} wurde gelöscht.`, "info");
    } catch {
      addToast("Fehler beim Löschen.", "error");
    } finally {
      setDeleteTarget(null);
    }
  }

  async function handlePause(org: Organization) {
    const newStatus = org.status === "paused" ? "active" : "paused";
    try {
      const updated = await organizationService.changeStatus(org.id, newStatus);
      setOrgs(prev => prev.map(o => o.id === org.id ? updated : o));
      trackActivity(newStatus === "paused" ? "org_paused" : "org_edited", org.name, org.id);
      addToast(
        newStatus === "paused" ? `${org.name} wurde pausiert.` : `${org.name} wurde reaktiviert.`,
        newStatus === "paused" ? "warning" : "success",
      );
    } catch {
      addToast("Fehler beim Statuswechsel.", "error");
    } finally {
      setPauseTarget(null);
    }
  }

  async function handleClose(org: Organization) {
    try {
      const updated = await organizationService.changeStatus(org.id, "closed");
      setOrgs(prev => prev.map(o => o.id === org.id ? updated : o));
      trackActivity("org_closed", org.name, org.id);
      addToast(`${org.name} wurde geschlossen.`, "info");
    } catch {
      addToast("Fehler beim Schließen.", "error");
    } finally {
      setCloseTarget(null);
    }
  }

  async function handleArchive(org: Organization) {
    try {
      const updated = await organizationService.changeStatus(org.id, "archived");
      setOrgs(prev => prev.map(o => o.id === org.id ? updated : o));
      trackActivity("org_archived", org.name, org.id);
      addToast(`${org.name} wurde archiviert.`, "info");
    } catch {
      addToast("Fehler beim Archivieren.", "error");
    } finally {
      setArchiveTarget(null);
    }
  }

  function handleInviteSent(sent: SentInvite[]) {
    sent.forEach(s => trackActivity("user_invited", s.orgName, s.orgId, s.email));
    addToast(
      sent.length === 1
        ? `Einladung an ${sent[0].name || sent[0].email} gesendet.`
        : `${sent.length} Einladungen gesendet.`,
      "success"
    );
    loadAllUsers();
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    return orgs.filter(o => o.name.toLowerCase().includes(q));
  }, [orgs, search]);

  const lastActivityMap = useMemo<Record<string, string | undefined>>(() => {
    const map: Record<string, string> = {};
    for (const a of activities) {
      if (!map[a.orgName]) map[a.orgName] = new Date(a.timestamp).toLocaleDateString("de-CH");
    }
    return map;
  }, [activities]);

  const costMonths = useMemo(() => availableMonths(costs), [costs]);

  const filteredCosts = useMemo(() => {
    const q = costSearch.toLowerCase();
    return costs
      .filter(c => c.month === costMonth)
      .filter(c => !q || c.orgName.toLowerCase().includes(q));
  }, [costs, costMonth, costSearch]);

  const orgCostMap = useMemo<Record<string, number | undefined>>(() => {
    const map: Record<string, number> = {};
    costs.filter(c => c.month === currentMonth()).forEach(c => { map[c.orgId] = c.totalCost; });
    return map;
  }, [costs]);

  const filteredUsers = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    return userGroups
      .flatMap(g => g.users.map(u => ({ ...u, orgId: g.orgId, orgName: g.orgName })))
      .filter(u => !q
        || u.email.toLowerCase().includes(q)
        || (u.name ?? "").toLowerCase().includes(q)
        || u.orgName.toLowerCase().includes(q));
  }, [userGroups, userSearch]);

  const kpiData = useMemo(() => {
    const cm = currentMonth();
    const currentCosts = costs.filter(c => c.month === cm);
    const totalCost      = currentCosts.reduce((s, c) => s + c.totalCost, 0);
    const totalAnalyses  = currentCosts.reduce((s, c) => s + c.analyseCount, 0);
    // Belegter Speicher kommt aus /api/organizations (die Kostenzeilen führen keinen Verbrauch);
    // null, solange keine Org einen Wert liefert → "—" statt einer falschen 0.
    const storageKnown   = orgs.filter(o => o.storageGB !== undefined);
    const totalStorageGB = storageKnown.length ? storageKnown.reduce((s, o) => s + (o.storageGB ?? 0), 0) : null;
    const activeOrgs     = orgs.filter(o => o.status === "active").length;
    const totalProjects  = orgs.reduce((s, o) => s + (o.projectCount ?? 0), 0);
    const totalUsers     = orgs.reduce((s, o) => s + (o.userCount ?? 0), 0);
    return {
      orgsCount: hydrated ? orgs.length : 0,
      activeOrgs, totalProjects, totalUsers, totalAnalyses,
      totalCost, totalStorageGB,
      avgCostPerAnalyse: totalAnalyses > 0 ? totalCost / totalAnalyses : 0,
      monthlyTotalsData: monthlyTotals(costs),
      monthlyBudget: orgs.reduce((s, o) => s + (o.monthlyBudget ?? 0), 0),
      prevMonthTotal: costs
        .filter(c => c.month === prevMonth(cm))
        .reduce((s, c) => s + c.totalCost, 0),
    };
  }, [orgs, hydrated, costs]);

  const isDetailOrgInFiltered = detailOrg ? orgs.find(o => o.id === detailOrg.id) ?? null : null;

  return (
    <>
      <Toast toasts={toasts} onRemove={id => setToasts(prev => prev.filter(t => t.id !== id))} />
      <AdminNav userEmail={userEmail} />

      <main className="max-w-7xl mx-auto px-6 py-8 space-y-8">

        {/* Greeting */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-medium text-[#7B8299] uppercase tracking-widest mb-1">
              {todayStr()}
            </p>
            <h1 className="text-2xl font-bold text-white">
              Willkommen zurück{userName ? `, ${userName}` : ""}
            </h1>
          </div>

          {hydrated && lastOpened && (
            <div className="flex-shrink-0 flex items-center gap-4 bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl px-5 py-3.5">
              <div>
                <p className="text-[10px] font-semibold text-[#7B8299] uppercase tracking-widest">Zuletzt geöffnet</p>
                <p className="text-sm font-semibold text-white mt-0.5">{lastOpened.name}</p>
              </div>
              <div className="h-7 w-px bg-[rgba(60,63,68,0.4)]" />
              <button
                onClick={() => {
                  const org = orgs.find(o => o.id === lastOpened.id);
                  if (org) handleOpen(org); else router.push("/dashboard");
                }}
                className="text-sm font-semibold text-[#85A6E9] hover:text-white bg-[#2862D7]/10 hover:bg-[#2862D7] px-3.5 py-2 rounded-xl transition-all active:scale-[0.97] whitespace-nowrap"
              >
                Weiter öffnen →
              </button>
            </div>
          )}
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
          <KpiCard label="Organisationen" value={hydrated ? kpiData.orgsCount.toString() : "—"} />
          <KpiCard label="Aktive Orgs"    value={hydrated ? kpiData.activeOrgs.toString() : "—"}
            note={hydrated ? `${orgs.filter(o => o.status !== "active").length} inaktiv` : undefined} />
          <KpiCard label="Projekte"       value={kpiData.totalProjects.toString()} />
          <KpiCard label="Benutzer"       value={kpiData.totalUsers.toString()} />
          <KpiCard label="Analysen / Mo." value={kpiData.totalAnalyses.toString()} />
          <KpiCard label="Kosten / Mo."   value={`CHF ${kpiData.totalCost.toFixed(2)}`} accent />
          <KpiCard label="Ø / Analyse"    value={`CHF ${kpiData.avgCostPerAnalyse.toFixed(2)}`} accent />
          <KpiCard label="Speicher ges."  value={kpiData.totalStorageGB === null ? "—" : kpiData.totalStorageGB < 1 ? `${(kpiData.totalStorageGB * 1000).toFixed(1)} MB` : `${kpiData.totalStorageGB.toFixed(2)} GB`} />
        </div>

        {/* Quick actions */}
        <div className="flex gap-3 flex-wrap sm:flex-nowrap">
          <QuickActionBtn
            label="Neue Organisation"
            onClick={() => { setEditTarget(null); setModalOpen(true); }}
            icon={<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 3V15M3 9H15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>}
          />
          <QuickActionBtn
            label="Benutzer einladen"
            onClick={() => {
              if (!hydrated || orgs.length === 0) { addToast("Bitte zuerst eine Organisation erstellen.", "info"); return; }
              setInviteModalOpen(true);
            }}
            icon={<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M12 11.5C13.38 11.5 14.5 10.38 14.5 9C14.5 7.62 13.38 6.5 12 6.5C10.62 6.5 9.5 7.62 9.5 9C9.5 10.38 10.62 11.5 12 11.5Z" stroke="currentColor" strokeWidth="1.3" /><path d="M7 15C7 13.34 9.24 12 12 12C14.76 12 17 13.34 17 15M3 5.5V9.5M5.5 7.5H1" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" /></svg>}
          />
          <QuickActionBtn
            label="Bericht exportieren"
            onClick={() => addToast("Noch keine Daten verfügbar.", "info")}
            icon={<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 11V3M6 8L9 11L12 8M3 13V15H15V13" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>}
          />
          <QuickActionBtn
            label="Systemstatus"
            onClick={() => document.getElementById("systemstatus-section")?.scrollIntoView({ behavior: "smooth" })}
            icon={<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M9 2L10.9 6.26L15.5 6.9L12.25 10.07L13.08 14.65L9 12.4L4.92 14.65L5.75 10.07L2.5 6.9L7.1 6.26L9 2Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>}
          />
          <QuickActionBtn
            label="Normen-Datenbank"
            onClick={() => router.push("/admin/norms")}
            icon={<svg width="18" height="18" viewBox="0 0 18 18" fill="none"><path d="M4 3.5C4 2.67 4.67 2 5.5 2H12.5C13.33 2 14 2.67 14 3.5V15.5L9 13L4 15.5V3.5Z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" /></svg>}
          />
        </div>

        {/* Cost overview */}
        <div className="space-y-4">
          <SectionHeader title="Kostenübersicht" />
          <CostOverview
            costs={costs.filter(c => c.month === currentMonth())}
            monthlyTotals={kpiData.monthlyTotalsData}
            currentMonth={currentMonth()}
            prevMonthTotal={kpiData.prevMonthTotal}
            monthlyBudget={kpiData.monthlyBudget}
            fmtMonth={fmtMonth}
          />
        </div>

        {/* Organisations */}
        <div className="space-y-4">
          <SectionHeader title="Organisationen" />
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">Alle Organisationen</h2>
              <p className="text-xs text-[#7B8299] mt-0.5">
                {filtered.length} {filtered.length === 1 ? "Eintrag" : "Einträge"}
                {search ? ` für „${search}"` : ""}
              </p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="flex-1 sm:w-56">
                <SearchInput value={search} onChange={setSearch} placeholder="Organisation suchen..." />
              </div>
              <button
                onClick={() => { setEditTarget(null); setModalOpen(true); }}
                className="flex-shrink-0 flex items-center gap-1.5 bg-[#2862D7] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#3470E8] active:scale-[0.97] transition-all shadow-sm shadow-[#2862D7]/25 whitespace-nowrap"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                  <path d="M5.5 1V10M1 5.5H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                Neue Organisation
              </button>
            </div>
          </div>

          {!hydrated || seeding ? (
            <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl h-48 animate-pulse" />
          ) : filtered.length === 0 ? (
            <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl p-12 text-center">
              <p className="text-[#ABAEBB] text-sm font-medium">Keine Organisationen gefunden</p>
              {search && (
                <button onClick={() => setSearch("")} className="mt-2 text-sm text-[#85A6E9] hover:underline">
                  Filter zurücksetzen
                </button>
              )}
            </div>
          ) : (
            <OrgTable
              orgs={filtered}
              lastActivityMap={lastActivityMap}
              costMap={orgCostMap}
              onOpen={handleOpen}
              onEdit={org => { setEditTarget(org); setModalOpen(true); }}
              onDelete={org => setDeleteTarget(org)}
              onPause={org => { if (org.status === "paused") { handlePause(org); } else { setPauseTarget(org); } }}
              onClose={org => setCloseTarget(org)}
              onArchive={org => setArchiveTarget(org)}
              onDetail={org => setDetailOrg(org)}
            />
          )}
        </div>

        {/* Users */}
        <div className="space-y-4">
          <SectionHeader title="Nutzer" />
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-white">Alle Nutzer</h2>
              <p className="text-xs text-[#7B8299] mt-0.5">
                {filteredUsers.length} {filteredUsers.length === 1 ? "Nutzer" : "Nutzer"}
                {userSearch ? ` für „${userSearch}"` : ` in ${userGroups.length} ${userGroups.length === 1 ? "Organisation" : "Organisationen"}`}
              </p>
            </div>
            <div className="flex items-center gap-2 w-full sm:w-auto">
              <div className="flex-1 sm:w-56">
                <SearchInput value={userSearch} onChange={setUserSearch} placeholder="Name, E-Mail oder Organisation..." />
              </div>
              <button
                onClick={() => {
                  if (!hydrated || orgs.length === 0) { addToast("Bitte zuerst eine Organisation erstellen.", "info"); return; }
                  setInviteModalOpen(true);
                }}
                className="flex-shrink-0 flex items-center gap-1.5 bg-[#2862D7] text-white text-sm font-semibold px-4 py-2.5 rounded-xl hover:bg-[#3470E8] active:scale-[0.97] transition-all shadow-sm shadow-[#2862D7]/25 whitespace-nowrap"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                  <path d="M5.5 1V10M1 5.5H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                Nutzer einladen
              </button>
            </div>
          </div>

          {usersLoading && userGroups.length === 0 ? (
            <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl h-48 animate-pulse" />
          ) : userGroups.every(g => g.users.length === 0) ? (
            <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl p-12 text-center">
              <p className="text-[#ABAEBB] text-sm font-medium">Noch keine Nutzer eingeladen</p>
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl p-12 text-center">
              <p className="text-[#ABAEBB] text-sm font-medium">Keine Nutzer gefunden</p>
              <button onClick={() => setUserSearch("")} className="mt-2 text-sm text-[#85A6E9] hover:underline">
                Filter zurücksetzen
              </button>
            </div>
          ) : (
            <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[820px]">
                  <thead>
                    <tr className="border-b border-[rgba(60,63,68,0.4)] bg-[rgba(23,37,64,0.5)]">
                      <th className="py-3.5 px-5 text-[11px] font-semibold text-[#7B8299] uppercase tracking-wider text-left">Name</th>
                      <th className="py-3.5 px-3 text-[11px] font-semibold text-[#7B8299] uppercase tracking-wider text-left">E-Mail</th>
                      <th className="py-3.5 px-3 text-[11px] font-semibold text-[#7B8299] uppercase tracking-wider text-left">Organisation</th>
                      <th className="py-3.5 px-3 text-[11px] font-semibold text-[#7B8299] uppercase tracking-wider text-left">Status</th>
                      <th className="py-3.5 px-3 text-[11px] font-semibold text-[#7B8299] uppercase tracking-wider text-right">Rolle</th>
                      <th className="py-3.5 px-5 w-10" />
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.map(u => (
                      <tr key={u.id} className="hover:bg-[#1E2D4A]/60 transition-colors border-b border-[rgba(60,63,68,0.3)] last:border-0">
                        <td className="px-5 py-3 font-medium text-white">{u.name ?? "—"}</td>
                        <td className="px-3 py-3 text-[#ABAEBB]">{u.email}</td>
                        <td className="px-3 py-3 text-[#ABAEBB]">{u.orgName}</td>
                        <td className="px-3 py-3">
                          <span className={`inline-flex items-center gap-1.5 text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            u.status === "active" ? "bg-emerald-500/15 text-emerald-400" : "bg-amber-500/15 text-amber-400"
                          }`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${u.status === "active" ? "bg-emerald-500" : "bg-amber-400"}`} />
                            {u.status === "active" ? "Aktiv" : "Ausstehend"}
                          </span>
                        </td>
                        <td className="px-3 py-3 text-right">
                          <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                            u.role === "org_admin" || u.role === "super_admin"
                              ? "bg-[#2862D7]/10 text-[#85A6E9]"
                              : "bg-[rgba(60,63,68,0.5)] text-[#ABAEBB]"
                          }`}>
                            {ROLE_LABELS[u.role] ?? u.role}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right">
                          {u.status === "pending" && (
                            <button
                              onClick={() => resendInvite(u.orgId, u.email, u.role, u.name)}
                              disabled={resendingId === `${u.orgId}:${u.email}`}
                              className="text-xs font-medium text-[#85A6E9] hover:text-white disabled:opacity-40 transition-colors whitespace-nowrap"
                              title="Einladung erneut senden"
                            >
                              {resendingId === `${u.orgId}:${u.email}` ? "..." : "Erneut einladen"}
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Cost table + sidebar */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-start">
          <div className="lg:col-span-2 space-y-4">
            <SectionHeader title="Kosten pro Organisation" />
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h2 className="text-base font-semibold text-white">Kostendetails</h2>
                <p className="text-xs text-[#7B8299] mt-0.5">
                  {filteredCosts.length === 0 ? "Noch keine Kostendaten" : `${filteredCosts.length} Einträge`}
                </p>
              </div>
              {costMonths.length > 0 && (
                <div className="flex items-center gap-2 w-full sm:w-auto">
                  <select
                    value={costMonth}
                    onChange={e => setCostMonth(e.target.value)}
                    className="border border-[rgba(133,166,233,0.25)] rounded-xl px-3 py-2.5 text-sm text-white bg-[rgba(23,37,64,0.6)] focus:outline-none focus:ring-2 focus:ring-[#2862D7]/40 focus:border-[#2862D7] transition-colors"
                  >
                    {costMonths.map(m => (
                      <option key={m} value={m}>{fmtMonth(m)}</option>
                    ))}
                  </select>
                  <div className="flex-1 sm:w-44">
                    <SearchInput value={costSearch} onChange={setCostSearch} placeholder="Organisation..." />
                  </div>
                </div>
              )}
            </div>
            {costsLoading && costs.length === 0 ? (
              <div className="bg-[#172540] border border-[rgba(60,63,68,0.5)] rounded-2xl h-48 animate-pulse" />
            ) : (
              <CostTable costs={filteredCosts} />
            )}
          </div>

          <div className="space-y-4 lg:sticky lg:top-20">
            <ActivityFeed activities={activities} />
            <div id="systemstatus-section">
              <SystemStatus
                services={systemServices}
                checkedAt={systemCheckedAt}
                loading={systemLoading}
                onRefresh={loadSystemStatus}
              />
            </div>
          </div>
        </div>

        {/* Invoices */}
        <div className="space-y-4">
          <SectionHeader title="Rechnungen & Exporte" />
          <InvoicesSection onToast={addToast} />
        </div>

      </main>

      {inviteModalOpen && (
        <InviteUserModal
          orgs={orgs}
          defaultOrgId={lastOpened?.id ?? orgs[0]?.id}
          onClose={() => setInviteModalOpen(false)}
          onSent={handleInviteSent}
        />
      )}

      {modalOpen && (
        <OrgModal
          org={editTarget}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditTarget(null); }}
        />
      )}

      {deleteTarget && (
        <ConfirmModal
          orgName={deleteTarget.name}
          title="Organisation löschen"
          description="wird dauerhaft gelöscht. Diese Aktion kann nicht rückgängig gemacht werden."
          confirmLabel="Löschen"
          confirmCls="bg-red-600 text-white hover:bg-red-700"
          onConfirm={() => handleDelete(deleteTarget)}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {pauseTarget && (
        <ConfirmModal
          orgName={pauseTarget.name}
          title="Organisation pausieren"
          description="wird pausiert. Benutzer können sich nicht mehr einloggen."
          confirmLabel="Pausieren"
          confirmCls="bg-amber-500 text-white hover:bg-amber-600"
          onConfirm={() => handlePause(pauseTarget)}
          onClose={() => setPauseTarget(null)}
        />
      )}

      {closeTarget && (
        <ConfirmModal
          orgName={closeTarget.name}
          title="Organisation schließen"
          description="wird geschlossen. Daten werden aufbewahrt, aber der Zugang gesperrt."
          confirmLabel="Schließen"
          confirmCls="bg-[#172540] border border-[rgba(60,63,68,0.5)] text-white hover:bg-[#1E2D4A]"
          onConfirm={() => handleClose(closeTarget)}
          onClose={() => setCloseTarget(null)}
        />
      )}

      {archiveTarget && (
        <ConfirmModal
          orgName={archiveTarget.name}
          title="Organisation archivieren"
          description="wird archiviert und ist schreibgeschützt."
          confirmLabel="Archivieren"
          confirmCls="bg-[rgba(60,63,68,0.6)] text-white hover:bg-[rgba(60,63,68,0.8)]"
          onConfirm={() => handleArchive(archiveTarget)}
          onClose={() => setArchiveTarget(null)}
        />
      )}

      <OrgDetailPanel
        org={isDetailOrgInFiltered}
        costs={costs}
        onClose={() => setDetailOrg(null)}
        onEdit={() => {
          if (isDetailOrgInFiltered) { setEditTarget(isDetailOrgInFiltered); setModalOpen(true); }
        }}
        onToast={addToast}
      />
    </>
  );
}
