"use client";

import { useCallback, useEffect, useState } from "react";
import ConfirmDialog from "@/components/admin/analyses/ConfirmDialog";
import Toast from "@/components/admin/Toast";
import PageHeader from "@/components/admin/shell/PageHeader";
import type { ToastMessage } from "@/components/admin/types";
import { organizationService } from "@/lib/services/organizationService";
import AnnouncementFormDialog, { type AnnouncementPayload, type OrgOption } from "./AnnouncementFormDialog";
import { TYPE_OPTIONS, type Announcement, type AnnouncementState, type AnnouncementType } from "./types";
import { formatDateTime } from "./time";

const API = "/api/v1/admin/announcements";

const TYPE_BADGE: Record<AnnouncementType, string> = {
  info: "border-[#CBBFAE]/30 bg-[#CBBFAE]/10 text-[#6b6153]",
  warning: "border-[#D6A45F]/30 bg-[#D6A45F]/10 text-[#7a4f00]",
  maintenance: "border-[#D6A45F]/35 bg-[#D6A45F]/10 text-[#7a4f00]",
  critical: "border-[#D87979]/40 bg-[#D87979]/10 text-[#a3201a]",
};

const STATE_BADGE: Record<AnnouncementState, { label: string; cls: string }> = {
  scheduled: { label: "Geplant", cls: "border-[#CBBFAE]/30 bg-[#CBBFAE]/10 text-[#6b6153]" },
  live: { label: "Live", cls: "border-[#65A88A]/30 bg-[#65A88A]/10 text-[#136a40]" },
  expired: { label: "Abgelaufen", cls: "border-[#8c8b8e] bg-[rgba(21,20,20,.05)] text-[#5f5f64]" },
  disabled: { label: "Deaktiviert", cls: "border-[#8c8b8e] bg-[rgba(21,20,20,.05)] text-[#5f5f64]" },
};

const ACTION_BTN = "rounded-lg border border-[#151414] px-3 py-1.5 text-[13px] font-medium text-[#151414] transition-colors hover:bg-[#151414] hover:text-white disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#151414]";

function typeLabel(t: AnnouncementType) {
  return TYPE_OPTIONS.find(o => o.value === t)?.label ?? t;
}

function excerpt(text: string, max = 110) {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: init?.body ? { "Content-Type": "application/json" } : undefined,
    });
  } catch {
    throw new Error("Keine Verbindung zum Server.");
  }
  let json: { data?: T; error?: string } | null = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) throw new Error(json?.error ?? "Die Anfrage ist fehlgeschlagen.");
  return json?.data as T;
}

function Skeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Ankündigungen werden geladen">
      {[0, 1, 2].map(i => (
        <div key={i} className="h-24 animate-pulse rounded-2xl border border-[rgba(21,20,20,.08)] bg-[rgba(21,20,20,.05)]" />
      ))}
    </div>
  );
}

export default function AnnouncementsManager() {
  const [items, setItems] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [orgs, setOrgs] = useState<OrgOption[]>([]);
  const [orgsLoading, setOrgsLoading] = useState(true);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Announcement | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleting, setDeleting] = useState<Announcement | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const pushToast = useCallback((type: ToastMessage["type"], message: string) => {
    setToasts(prev => [...prev, { id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, type, message }]);
  }, []);
  const removeToast = useCallback((id: string) => setToasts(prev => prev.filter(t => t.id !== id)), []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const data = await request<Announcement[]>(API, { cache: "no-store" });
      setItems(Array.isArray(data) ? data : []);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Ankündigungen konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    organizationService
      .list()
      .then(list => setOrgs(list.map(o => ({ id: o.id, name: o.name }))))
      .catch(() => setOrgs([]))
      .finally(() => setOrgsLoading(false));
  }, [load]);

  function openCreate() {
    setEditing(null);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(a: Announcement) {
    setEditing(a);
    setFormError(null);
    setFormOpen(true);
  }

  function closeForm() {
    if (saving) return;
    setFormOpen(false);
    setEditing(null);
    setFormError(null);
  }

  async function handleSubmit(payload: AnnouncementPayload) {
    setSaving(true);
    setFormError(null);
    try {
      if (editing) {
        await request(`${API}/${editing.id}`, { method: "PATCH", body: JSON.stringify(payload) });
      } else {
        await request(API, { method: "POST", body: JSON.stringify(payload) });
      }
      pushToast("success", editing ? "Ankündigung gespeichert." : "Ankündigung erstellt.");
      setSaving(false);
      setFormOpen(false);
      setEditing(null);
      await load();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Speichern fehlgeschlagen.";
      setFormError(msg);
      pushToast("error", msg);
      setSaving(false);
    }
  }

  async function toggleActive(a: Announcement) {
    setBusyId(a.id);
    try {
      await request(`${API}/${a.id}`, { method: "PATCH", body: JSON.stringify({ active: !a.active }) });
      pushToast("success", a.active ? "Ankündigung deaktiviert." : "Ankündigung aktiviert.");
      await load();
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setDeleteBusy(true);
    try {
      await request(`${API}/${deleting.id}`, { method: "DELETE" });
      pushToast("success", "Ankündigung gelöscht.");
      setDeleting(null);
      await load();
    } catch (e) {
      pushToast("error", e instanceof Error ? e.message : "Löschen fehlgeschlagen.");
    } finally {
      setDeleteBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-[1680px]">
      <div className="space-y-6">
      <PageHeader
        variant="hero"
        photo="banner"
        overlap={false}
        title="Ankündigungen"
        subtitle="Wartungs- und Hinweisbanner für alle Nutzer oder eine einzelne Organisation."
        actions={
          <button type="button" onClick={openCreate} className="tba-pill-btn">
            Neue Ankündigung
          </button>
        }
      />

      {items.length > 0 && (
        <div className="tba-glass tba-glass--dark tba-card tba-card--static grid grid-cols-3 gap-4 rounded-[20px] p-5">
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-wider text-white/70">Gesamt</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{items.length}</p>
          </div>
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-wider text-white/70">Live</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{items.filter(a => a.state === "live").length}</p>
          </div>
          <div>
            <p className="text-[13px] font-semibold uppercase tracking-wider text-white/70">Geplant</p>
            <p className="mt-1 text-2xl font-bold tabular-nums text-white">{items.filter(a => a.state === "scheduled").length}</p>
          </div>
        </div>
      )}

      {loading && items.length === 0 ? (
        <Skeleton />
      ) : loadError ? (
        <div role="alert" className="rounded-2xl border border-[#D87979]/30 bg-[#D87979]/10 p-6 text-center">
          <p className="mb-4 text-sm text-[#a3201a]">{loadError}</p>
          <button type="button" onClick={load} className={ACTION_BTN}>Erneut versuchen</button>
        </div>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#8c8b8e] bg-[rgba(21,20,20,.05)] p-10 text-center">
          <p className="mb-1 text-base font-semibold text-[#151414]">Noch keine Ankündigungen</p>
          <p className="mb-5 text-sm text-[#5f5f64]">Legen Sie die erste Ankündigung an, um Nutzer über Wartungen oder Änderungen zu informieren.</p>
          <button
            type="button"
            onClick={openCreate}
            className="rounded-xl tba-btn bg-[#151414] hover:bg-[#2e2e30] px-4 py-2.5 text-sm font-semibold text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-[#151414]"
          >
            Neue Ankündigung
          </button>
        </div>
      ) : (
        <ul className="tba-stagger space-y-3" aria-busy={loading}>
          {items.map(a => {
            const st = STATE_BADGE[a.state];
            const busy = busyId === a.id;
            return (
              <li key={a.id} className="tba-card tba-card--static rounded-2xl border border-[rgba(21,20,20,.08)] bg-white p-4 sm:p-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-md border px-2 py-0.5 text-[13px] font-bold uppercase tracking-wider ${TYPE_BADGE[a.type]}`}>{typeLabel(a.type)}</span>
                  <span className={`rounded-md border px-2 py-0.5 text-[13px] font-bold uppercase tracking-wider ${st.cls}`}>{st.label}</span>
                  <span className="text-[13px] text-[#5f5f64]">{a.orgId ? (a.orgName ?? "Organisation") : "Alle Nutzer"}</span>
                </div>
                <h2 className="mt-2 text-base font-semibold text-[#151414]" style={{ overflowWrap: "anywhere" }}>{a.title}</h2>
                <p className="mt-1 text-sm text-[#46464a]" style={{ overflowWrap: "anywhere" }}>{excerpt(a.message)}</p>
                <p className="mt-2 text-[13px] text-[#5f5f64]">
                  {formatDateTime(a.startsAt)} {a.endsAt ? `bis ${formatDateTime(a.endsAt)}` : "· ohne Ende"}
                  {a.createdByEmail ? ` · von ${a.createdByEmail}` : ""}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button type="button" onClick={() => openEdit(a)} disabled={busy} className={ACTION_BTN}>Bearbeiten</button>
                  <button type="button" onClick={() => toggleActive(a)} disabled={busy} className={ACTION_BTN}>
                    {busy ? "Bitte warten …" : a.active ? "Deaktivieren" : "Aktivieren"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleting(a)}
                    disabled={busy}
                    className="rounded-lg border border-[#a3201a] px-3 py-1.5 text-[13px] font-medium text-[#a3201a] transition-colors hover:bg-[#D87979]/15 disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#D87979]"
                  >
                    Löschen
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      </div>

      {formOpen && (
        <AnnouncementFormDialog
          existing={editing}
          orgs={orgs}
          orgsLoading={orgsLoading}
          saving={saving}
          serverError={formError}
          onSubmit={handleSubmit}
          onClose={closeForm}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title="Ankündigung löschen?"
          description={`«${excerpt(deleting.title, 60)}» wird endgültig gelöscht und ist für Nutzer nicht mehr sichtbar.`}
          confirmLabel="Löschen"
          busy={deleteBusy}
          onConfirm={confirmDelete}
          onClose={() => { if (!deleteBusy) setDeleting(null); }}
        />
      )}

      <Toast toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
