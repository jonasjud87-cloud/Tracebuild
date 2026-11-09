"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import LogoMark from "@/components/admin/shell/LogoMark";

// ── Types ─────────────────────────────────────────────────────────────────────

type UserRole = "super_admin" | "org_admin" | "project_manager" | "member";

interface OrgUser {
  id: string;
  email: string;
  name: string | null;
  role: UserRole;
  created_at: string;
}

interface OrgProject {
  id: string;
  name: string;
  domain: string;
  status: string;
  created_at: string;
  bauzone: string | null;
  location: { canton?: string; municipality?: string } | null;
  documents: { count: number }[];
  project_members: { count: number }[];
}

interface ProjectMember {
  user_id: string;
  added_at: string;
  users: { id: string; email: string; role: string } | null;
}

// ── Role labels ───────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<UserRole, string> = {
  super_admin:     "Super Admin",
  org_admin:       "Org Admin",
  project_manager: "Projektleiter",
  member:          "Mitglied",
};

const ROLE_STYLE: Record<UserRole, string> = {
  super_admin:     "bg-[#fde7e5] text-[#a3201a]",
  org_admin:       "bg-[#fff1d6] text-[#7a4f00]",
  project_manager: "bg-[#cbbfae]/30 text-[#6b6153]",
  member:          "bg-[rgba(21,20,20,0.08)] text-[#46464a]",
};

const ASSIGNABLE_ROLES: UserRole[] = ["org_admin", "project_manager", "member"];

// ── Tiny helpers ──────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("de-CH", { day: "numeric", month: "short", year: "numeric" });
}

function RoleBadge({ role }: { role: UserRole }) {
  return (
    <span className={`text-[13px] font-semibold px-2 py-0.5 rounded-full ${ROLE_STYLE[role] ?? ROLE_STYLE.member}`}>
      {ROLE_LABELS[role] ?? role}
    </span>
  );
}

// ── Confirm modal ─────────────────────────────────────────────────────────────

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
      className="fixed inset-0 z-50 flex items-center justify-center tba-scrim tbb-fade px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="tba-glass tba-glass--modal rounded-2xl tbb-rise w-full max-w-sm p-7">
        <h3 className="text-base font-bold text-[#151414] text-center mb-2">{title}</h3>
        <p className="text-sm text-[#46464a] text-center mb-6">{description}</p>
        <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border border-[#8c8b8e] rounded-xl py-2.5 text-sm font-medium text-[#151414] hover:bg-[#f6f3ee] transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-xl py-2.5 text-sm font-semibold bg-[#b42318] text-white hover:bg-[#8f1c12] active:scale-[0.97] transition-all"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Invite modal ──────────────────────────────────────────────────────────────

function InviteModal({
  onClose, onSuccess,
}: {
  onClose: () => void;
  onSuccess: (msg: string) => void;
}) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("member");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmedName = name.trim().replace(/\s+/g, " ");
    if (trimmedName.length < 2) { setError("Bitte den Namen der Person angeben."); return; }
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/v1/admin/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmedName, email: email.trim().toLowerCase(), role }),
      });
      const json = await res.json().catch(() => null) as { data: unknown; error: string | null } | null;
      if (!res.ok || !json || json.error) { setError(json?.error ?? `Fehler ${res.status}`); return; }
      onSuccess(`Einladung an ${trimmedName} gesendet.`);
      onClose();
    } catch {
      // Ohne catch bleibt der Modal bei einem Netzwerkfehler stumm stehen.
      setError("Netzwerkfehler — Einladung nicht gesendet.");
    } finally {
      setLoading(false);
    }
  }

  const iCls = [
    "w-full rounded-xl px-3 py-2.5 text-sm text-[#151414]",
    "bg-white border border-[#8c8b8e]",
    "placeholder:text-[#6e6e73]",
    "focus:outline-none focus:ring-2 focus:ring-[#cbbfae]/55 focus:border-[#151414]",
    "transition-colors",
  ].join(" ");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center tba-scrim tbb-fade px-4"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="tba-glass tba-glass--modal rounded-2xl tbb-rise w-full max-w-sm p-7">
        <h3 className="text-base font-bold text-[#151414] mb-5">Mitglied einladen</h3>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-semibold text-[#5f5f64] mb-1.5">Name</label>
            <input
              type="text"
              required
              value={name}
              onChange={e => { setName(e.target.value); if (error) setError(""); }}
              placeholder="Vor- und Nachname"
              className={iCls}
              autoFocus
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#5f5f64] mb-1.5">E-Mail</label>
            <input
              type="email"
              required
              value={email}
              onChange={e => { setEmail(e.target.value); if (error) setError(""); }}
              placeholder="name@firma.ch"
              className={iCls}
            />
          </div>
          <div>
            <label className="block text-sm font-semibold text-[#5f5f64] mb-1.5">Rolle</label>
            <select
              value={role}
              onChange={e => setRole(e.target.value as UserRole)}
              className={`${iCls} appearance-none`}
            >
              {ASSIGNABLE_ROLES.map(r => (
                <option key={r} value={r}>{ROLE_LABELS[r]}</option>
              ))}
            </select>
          </div>
          {error && <p className="text-sm text-[#a3201a]">{error}</p>}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 border border-[#8c8b8e] rounded-xl py-2.5 text-sm font-medium text-[#151414] hover:bg-[#f6f3ee] transition-colors"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={loading}
              className="flex-1 bg-[#151414] hover:bg-[#2e2e30] text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50 transition-colors"
            >
              {loading ? "Senden…" : "Einladen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Member assignment panel ───────────────────────────────────────────────────

function MembersPanel({
  project, orgUsers, onClose, onToast,
}: {
  project: OrgProject;
  orgUsers: OrgUser[];
  onClose: () => void;
  onToast: (msg: string) => void;
}) {
  const [members, setMembers] = useState<ProjectMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/projects/${project.id}/members`);
      const json = await res.json() as { data: ProjectMember[]; error: string | null };
      if (json.data) setMembers(json.data);
    } finally {
      setLoading(false);
    }
  }, [project.id]);

  useEffect(() => { load(); }, [load]);

  const memberIds = new Set(members.map(m => m.user_id));
  const available = orgUsers.filter(u => !memberIds.has(u.id));

  async function addMember() {
    if (!selectedUserId) return;
    setAdding(true);
    const res = await fetch(`/api/v1/admin/projects/${project.id}/members`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: selectedUserId }),
    });
    const json = await res.json().catch(() => null) as { error?: string | null } | null;
    if (!res.ok || json?.error) {
      onToast(`Fehler: ${json?.error ?? "Mitglied konnte nicht hinzugefügt werden."}`);
    } else {
      setSelectedUserId("");
      onToast("Mitglied hinzugefügt.");
      await load();
    }
    setAdding(false);
  }

  async function removeMember(userId: string) {
    const res = await fetch(`/api/v1/admin/projects/${project.id}/members`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ user_id: userId }),
    });
    const json = await res.json().catch(() => null) as { error?: string | null } | null;
    if (!res.ok || json?.error) {
      onToast(`Fehler: ${json?.error ?? "Mitglied konnte nicht entfernt werden."}`);
    } else {
      onToast("Mitglied entfernt.");
      await load();
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-end tba-scrim tbb-fade"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="rounded-l-[20px] rounded-r-none tba-glass tba-glass--modal h-full tbb-slide w-full max-w-sm p-6 overflow-y-auto flex flex-col gap-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-[13px] font-semibold text-[#46464a] uppercase tracking-widest">Mitglieder</p>
            <h3 className="text-base font-bold text-[#151414] mt-0.5">{project.name}</h3>
          </div>
          <button onClick={onClose} aria-label="Schliessen" className="text-[#5f5f64] hover:text-[#151414] transition-colors">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M2 2L16 16M16 2L2 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        {/* Add member */}
        {available.length > 0 && (
          <div className="flex gap-2">
            <select
              value={selectedUserId}
              onChange={e => setSelectedUserId(e.target.value)}
              className="flex-1 rounded-xl px-3 py-2 text-sm text-[#151414] bg-white border border-[#8c8b8e] focus:outline-none focus:ring-2 focus:ring-[#cbbfae]/55 focus:border-[#151414] transition-colors appearance-none"
            >
              <option value="">Mitglied hinzufügen…</option>
              {available.map(u => (
                <option key={u.id} value={u.id}>{u.name ? `${u.name} (${u.email})` : u.email}</option>
              ))}
            </select>
            <button
              onClick={addMember}
              disabled={!selectedUserId || adding}
              className="px-4 py-2 bg-[#151414] hover:bg-[#2e2e30] text-white text-sm font-semibold rounded-xl disabled:opacity-40 transition-colors"
            >
              +
            </button>
          </div>
        )}

        {/* Members list */}
        {loading ? (
          <div className="space-y-2">
            {[1, 2].map(i => <div key={i} className="h-12 bg-white rounded-xl animate-pulse" />)}
          </div>
        ) : members.length === 0 ? (
          <p className="text-sm text-[#5f5f64] text-center py-8">Keine Mitglieder zugewiesen</p>
        ) : (
          <div className="space-y-2">
            {members.map(m => (
              <div key={m.user_id} className="flex items-center justify-between bg-white rounded-xl px-4 py-3 border border-[rgba(21,20,20,0.08)]">
                <div>
                  <p className="text-sm font-medium text-[#151414]">{m.users?.email ?? m.user_id}</p>
                  <RoleBadge role={(m.users?.role ?? "member") as UserRole} />
                </div>
                <button
                  onClick={() => removeMember(m.user_id)}
                  className="text-[#5f5f64] hover:text-[#a3201a] transition-colors ml-3"
                  title="Entfernen"
                  aria-label="Mitglied entfernen"
                >
                  <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                    <path d="M2 2L12 12M12 2L2 12" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function Toast({ message, onDone }: { message: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed bottom-6 right-6 z-[60] bg-white border border-[rgba(21,20,20,0.08)] text-[#151414] text-sm px-5 py-3 rounded-2xl shadow-2xl tbb-rise">
      {message}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function OrgAdminPage() {
  const router = useRouter();
  const [tab, setTab] = useState<"projects" | "members">("projects");

  // Auth guard
  const [authorized, setAuthorized] = useState<boolean | null>(null);

  // Data
  const [users, setUsers]       = useState<OrgUser[]>([]);
  const [projects, setProjects] = useState<OrgProject[]>([]);
  const [loading, setLoading]   = useState(true);

  // Modals
  const [inviteOpen, setInviteOpen]         = useState(false);
  const [deleteUser, setDeleteUser]         = useState<OrgUser | null>(null);
  const [deleteProject, setDeleteProject]   = useState<OrgProject | null>(null);
  const [membersProject, setMembersProject] = useState<OrgProject | null>(null);

  // Toast
  const [toast, setToast] = useState("");

  const addToast = (msg: string) => setToast(msg);

  // ── Auth check ──
  useEffect(() => {
    createClient().auth.getUser().then(async ({ data }) => {
      if (!data.user) { router.replace("/login"); return; }
      // Fetch role from our users table
      const res = await fetch("/api/v1/admin/users");
      if (res.status === 403) { setAuthorized(false); return; }
      setAuthorized(true);
    });
  }, [router]);

  // ── Load data ──
  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [usersRes, projectsRes] = await Promise.all([
        fetch("/api/v1/admin/users").then(r => r.json() as Promise<{ data: OrgUser[] }>),
        fetch("/api/v1/admin/projects").then(r => r.json() as Promise<{ data: OrgProject[] }>),
      ]);
      setUsers(usersRes.data ?? []);
      setProjects(projectsRes.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (authorized) loadAll();
  }, [authorized, loadAll]);

  // ── Handlers ──
  async function handleRoleChange(userId: string, role: UserRole) {
    const res = await fetch(`/api/v1/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role }),
    });
    const json = await res.json() as { data: OrgUser; error: string | null };
    if (json.error) { addToast(`Fehler: ${json.error}`); return; }
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, role } : u));
    addToast("Rolle aktualisiert.");
  }

  async function handleDeleteUser(user: OrgUser) {
    const res = await fetch(`/api/v1/admin/users/${user.id}`, { method: "DELETE" });
    const json = await res.json() as { error: string | null };
    if (json.error) { addToast(`Fehler: ${json.error}`); return; }
    setUsers(prev => prev.filter(u => u.id !== user.id));
    addToast(`${user.email} entfernt.`);
    setDeleteUser(null);
  }

  async function handleDeleteProject(project: OrgProject) {
    const res = await fetch(`/api/v1/admin/projects/${project.id}`, { method: "DELETE" });
    const json = await res.json() as { error: string | null };
    if (json.error) { addToast(`Fehler: ${json.error}`); return; }
    setProjects(prev => prev.filter(p => p.id !== project.id));
    addToast(`${project.name} gelöscht.`);
    setDeleteProject(null);
  }

  // ── Guards ──
  if (authorized === null) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#cbbfae]/60 border-t-[#151414] rounded-full animate-spin" />
      </div>
    );
  }

  if (authorized === false) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <p className="text-[#46464a] text-sm">Zugriff verweigert — nur für Org-Admins.</p>
        <button onClick={() => router.replace("/dashboard")} className="text-sm font-semibold text-[#6b6153] hover:underline">
          Zum Dashboard →
        </button>
      </div>
    );
  }

  // ── Render ──
  return (
    <>
      {toast && <Toast message={toast} onDone={() => setToast("")} />}
      {inviteOpen && (
        <InviteModal
          onClose={() => setInviteOpen(false)}
          onSuccess={msg => { addToast(msg); loadAll(); }}
        />
      )}
      {deleteUser && (
        <ConfirmModal
          title="Mitglied entfernen"
          description={`${deleteUser.email} wird aus der Organisation entfernt.`}
          confirmLabel="Entfernen"
          onConfirm={() => handleDeleteUser(deleteUser)}
          onClose={() => setDeleteUser(null)}
        />
      )}
      {deleteProject && (
        <ConfirmModal
          title="Projekt löschen"
          description={`„${deleteProject.name}" und alle zugehörigen Daten werden dauerhaft gelöscht.`}
          confirmLabel="Löschen"
          onConfirm={() => handleDeleteProject(deleteProject)}
          onClose={() => setDeleteProject(null)}
        />
      )}
      {membersProject && (
        <MembersPanel
          project={membersProject}
          orgUsers={users}
          onClose={() => setMembersProject(null)}
          onToast={addToast}
        />
      )}

      {/* Header */}
      <header className="tba-onblack bg-[#151414] border-b border-[rgba(255,255,255,0.12)] sticky top-0 z-10">
        <div className="max-w-[1680px] mx-auto px-6 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/dashboard")}
              className="text-white/70 hover:text-white transition-colors"
              title="Zum Dashboard"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <path d="M12.5 15L7.5 10L12.5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </button>
            <LogoMark className="h-7 w-[20px] flex-shrink-0" />
            <span className="tba-brand">TraceBuild</span>
            <span className="hidden text-sm font-semibold text-white/70 sm:inline">· Organisation verwalten</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-white/70 uppercase tracking-widest hidden sm:block">
              {users.length} Mitglieder · {projects.length} Projekte
            </span>
          </div>
        </div>
      </header>

      <main className="max-w-[1680px] mx-auto px-6 py-8">
        {/* Tabs */}
        <div className="flex gap-1 mb-6 bg-white rounded-xl p-1 w-fit">
          {(["projects", "members"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2 rounded-lg text-sm font-semibold transition-all ${
                tab === t
                  ? "bg-[linear-gradient(135deg,#cbbfae,#b5a893)] text-[#151414]"
                  : "text-[#46464a] hover:text-[#151414]"
              }`}
            >
              {t === "projects" ? `Projekte (${projects.length})` : `Mitglieder (${users.length})`}
            </button>
          ))}
        </div>

        {/* ── Projekte tab ── */}
        {tab === "projects" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#151414]">Alle Projekte</h2>
            </div>

            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-16 tba-skel rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : projects.length === 0 ? (
              <div className="tba-glass rounded-2xl p-12 text-center">
                <p className="text-[#5f5f64] text-sm">Noch keine Projekte</p>
              </div>
            ) : (
              <div className="tba-glass tba-glass--flat rounded-2xl overflow-hidden">
                <div className="overflow-x-auto tba-scroll-x">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[rgba(21,20,20,0.08)] bg-[#f6f3ee]">
                      <th className="text-left text-[13px] font-semibold text-[#46464a] uppercase tracking-widest px-4 py-3">Projekt</th>
                      <th className="text-left text-[13px] font-semibold text-[#46464a] uppercase tracking-widest px-4 py-3 hidden sm:table-cell">Ort</th>
                      <th className="text-left text-[13px] font-semibold text-[#46464a] uppercase tracking-widest px-4 py-3 hidden md:table-cell">Pläne</th>
                      <th className="text-left text-[13px] font-semibold text-[#46464a] uppercase tracking-widest px-4 py-3 hidden md:table-cell">Mitglieder</th>
                      <th className="text-left text-[13px] font-semibold text-[#46464a] uppercase tracking-widest px-4 py-3 hidden lg:table-cell">Erstellt</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {projects.map((p, i) => (
                      <tr key={p.id} className={`tba-row transition-colors ${i < projects.length - 1 ? "border-b border-[rgba(21,20,20,0.08)]" : ""}`}>
                        <td className="px-4 py-3 max-w-[280px]">
                          <button
                            onClick={() => router.push(`/projects/${p.id}/norms`)}
                            title={p.name}
                            className="block max-w-full truncate font-semibold text-[#151414] hover:text-[#6b6153] transition-colors text-left"
                          >
                            {p.name}
                          </button>
                          {p.bauzone && (
                            <p className="text-[13px] text-[#46464a] mt-0.5">{p.bauzone}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-[#46464a] hidden sm:table-cell">
                          {p.location?.municipality ? `${p.location.municipality}, ${p.location.canton ?? ""}` : "—"}
                        </td>
                        <td className="px-4 py-3 text-[#46464a] hidden md:table-cell">
                          {p.documents?.[0]?.count ?? 0}
                        </td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <button
                            onClick={() => setMembersProject(p)}
                            className="text-[#46464a] hover:text-[#6b6153] transition-colors flex items-center gap-1.5"
                          >
                            <span>{p.project_members?.[0]?.count ?? 0}</span>
                            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
                              <path d="M1 9C1 7.34 3.24 6 5.5 6C7.76 6 10 7.34 10 9M5.5 4.5C6.88 4.5 8 3.38 8 2C8 0.62 6.88 0.5 5.5 0.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                            </svg>
                          </button>
                        </td>
                        <td className="px-4 py-3 text-[#5f5f64] text-sm hidden lg:table-cell">
                          {fmtDate(p.created_at)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2 justify-end">
                            <button
                              onClick={() => setMembersProject(p)}
                              className="text-sm font-medium text-[#5f5f64] hover:text-[#6b6153] transition-colors px-2 py-1 rounded-lg hover:bg-[#cbbfae]/25"
                            >
                              Mitglieder
                            </button>
                            <button
                              onClick={() => setDeleteProject(p)}
                              className="text-[#5f5f64] hover:text-[#a3201a] transition-colors p-1.5 rounded-lg hover:bg-[#fde7e5]"
                              title="Projekt löschen"
                            >
                              <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                                <path d="M1.5 3H11.5M5 3V1.5H8V3M10.5 3L10 11H3L2.5 3H10.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Mitglieder tab ── */}
        {tab === "members" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#151414]">Mitglieder der Organisation</h2>
              <button
                onClick={() => setInviteOpen(true)}
                className="flex items-center gap-1.5 bg-[#151414] hover:bg-[#2e2e30] text-white text-sm font-semibold px-4 py-2.5 rounded-xl active:scale-[0.97] transition-all shadow-sm shadow-[#cbbfae]/25"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                  <path d="M5.5 1V10M1 5.5H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                Einladen
              </button>
            </div>

            {loading ? (
              <div className="space-y-2">
                {[1, 2, 3].map(i => (
                  <div key={i} className="h-14 tba-skel rounded-2xl animate-pulse" />
                ))}
              </div>
            ) : users.length === 0 ? (
              <div className="tba-glass rounded-2xl p-12 text-center">
                <p className="text-[#5f5f64] text-sm">Noch keine Mitglieder</p>
              </div>
            ) : (
              <div className="tba-glass tba-glass--flat rounded-2xl overflow-hidden">
                <div className="overflow-x-auto tba-scroll-x">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[rgba(21,20,20,0.08)] bg-[#f6f3ee]">
                      <th className="text-left text-[13px] font-semibold text-[#46464a] uppercase tracking-widest px-4 py-3">Name</th>
                      <th className="text-left text-[13px] font-semibold text-[#46464a] uppercase tracking-widest px-4 py-3">E-Mail</th>
                      <th className="text-left text-[13px] font-semibold text-[#46464a] uppercase tracking-widest px-4 py-3">Rolle</th>
                      <th className="text-left text-[13px] font-semibold text-[#46464a] uppercase tracking-widest px-4 py-3 hidden sm:table-cell">Beigetreten</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((u, i) => (
                      <tr key={u.id} className={`tba-row transition-colors ${i < users.length - 1 ? "border-b border-[rgba(21,20,20,0.08)]" : ""}`}>
                        <td className="px-4 py-3 font-medium text-[#151414] max-w-[200px] truncate" title={u.name ?? undefined}>{u.name ?? "—"}</td>
                        <td className="px-4 py-3 text-[#46464a] max-w-[260px] truncate" title={u.email}>{u.email}</td>
                        <td className="px-4 py-3">
                          <select
                            value={u.role}
                            onChange={e => handleRoleChange(u.id, e.target.value as UserRole)}
                            className="border border-[#8c8b8e] rounded-lg px-2 py-1.5 text-sm bg-white text-[#151414] focus:outline-none focus:ring-2 focus:ring-[#cbbfae]/55 focus:border-[#151414] transition-colors appearance-none"
                          >
                            {ASSIGNABLE_ROLES.map(r => (
                              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-4 py-3 text-[#5f5f64] text-sm hidden sm:table-cell">
                          {fmtDate(u.created_at)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <button
                            onClick={() => setDeleteUser(u)}
                            className="text-[#5f5f64] hover:text-[#a3201a] transition-colors p-1.5 rounded-lg hover:bg-[#fde7e5]"
                            title="Entfernen"
                          >
                            <svg width="13" height="13" viewBox="0 0 13 13" fill="none">
                              <path d="M1.5 3H11.5M5 3V1.5H8V3M10.5 3L10 11H3L2.5 3H10.5Z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}
