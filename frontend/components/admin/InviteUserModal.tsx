"use client";

import { useState, useRef } from "react";
import type { Organization } from "./types";

export type InviteRole = "org_admin" | "project_manager" | "member";

export interface SentInvite {
  name: string;
  email: string;
  orgId: string;
  orgName: string;
  role: InviteRole;
}

interface QueueItem extends SentInvite {
  id: string;
  status: "pending" | "sending" | "sent" | "error";
  error?: string;
}

interface Props {
  orgs: Organization[];
  defaultOrgId?: string;
  onClose: () => void;
  onSent: (sent: SentInvite[]) => void;
}

const ROLE_LABELS: Record<InviteRole, string> = {
  org_admin: "Org Admin",
  project_manager: "Projektleiter",
  member: "Mitglied",
};

const inputCls = [
  "w-full rounded-xl px-3.5 py-2.5 text-sm text-white",
  "bg-[rgba(28,27,27,0.6)] border border-[rgba(203,191,174,0.55)]",
  "placeholder:text-[#adacab]",
  "focus:outline-none focus:ring-2 focus:ring-[#cbbfae]/40 focus:border-[#cbbfae]",
  "transition-colors",
].join(" ");

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function StatusIcon({ status }: { status: QueueItem["status"] }) {
  if (status === "sending") {
    return <div className="w-3.5 h-3.5 border-[1.5px] border-[#adacab]/40 border-t-[#cbbfae] rounded-full animate-spin" />;
  }
  if (status === "sent") {
    return (
      <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
        <path d="M2.5 7.2L5.5 10.2L11.5 3.8" stroke="#65A88A" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (status === "error") {
    return (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
        <path d="M2 2L10 10M10 2L2 10" stroke="#D87979" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    );
  }
  return <div className="w-1.5 h-1.5 rounded-full bg-[#adacab]" />;
}

export default function InviteUserModal({ orgs, defaultOrgId, onClose, onSent }: Props) {
  const [orgId, setOrgId] = useState(defaultOrgId ?? orgs[0]?.id ?? "");
  const [role, setRole]   = useState<InviteRole>("member");
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [formError, setFormError] = useState("");
  const [queue, setQueue]     = useState<QueueItem[]>([]);
  const [sending, setSending] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  const selectedOrg = orgs.find(o => o.id === orgId);

  function addToQueue(e?: React.FormEvent) {
    e?.preventDefault();
    const trimmedName  = name.trim().replace(/\s+/g, " ");
    const trimmedEmail = email.trim().toLowerCase();
    if (!orgId) { setFormError("Bitte Organisation wählen."); return; }
    if (trimmedName.length < 2) { setFormError("Bitte den Namen der Person angeben."); return; }
    if (!trimmedEmail || !EMAIL_RE.test(trimmedEmail)) { setFormError("Ungültige E-Mail-Adresse."); return; }
    if (queue.some(q => q.email === trimmedEmail && q.orgId === orgId)) {
      setFormError("Diese Person steht bereits auf der Liste.");
      return;
    }
    setFormError("");
    setQueue(prev => [...prev, {
      id: crypto.randomUUID(),
      name: trimmedName,
      email: trimmedEmail,
      orgId,
      orgName: selectedOrg?.name ?? "—",
      role,
      status: "pending",
    }]);
    setName("");
    setEmail("");
    nameRef.current?.focus();
  }

  function removeFromQueue(id: string) {
    setQueue(prev => prev.filter(q => q.id !== id));
  }

  async function sendAll() {
    const targets = queue.filter(q => q.status === "pending" || q.status === "error");
    if (targets.length === 0) return;
    setSending(true);
    const succeeded: SentInvite[] = [];

    for (const item of targets) {
      setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "sending", error: undefined } : q));
      try {
        const res = await fetch("/api/v1/admin/invite", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: item.name, email: item.email, role: item.role, org_id: item.orgId }),
        });
        const json = await res.json().catch(() => null) as { data: unknown; error: string | null } | null;
        if (!res.ok || !json || json.error) {
          setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "error", error: json?.error ?? `Fehler ${res.status}` } : q));
        } else {
          setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "sent" } : q));
          succeeded.push({ name: item.name, email: item.email, orgId: item.orgId, orgName: item.orgName, role: item.role });
        }
      } catch {
        setQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: "error", error: "Netzwerkfehler" } : q));
      }
    }

    setSending(false);
    if (succeeded.length > 0) onSent(succeeded);
  }

  const pendingCount = queue.filter(q => q.status === "pending" || q.status === "error").length;
  const hasSent = queue.some(q => q.status === "sent");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center tba-scrim tbb-fade px-4 py-6 overflow-y-auto"
      onClick={e => { if (e.target === e.currentTarget && !sending) onClose(); }}
    >
      <div className="tba-glass tba-glass--modal rounded-2xl tbb-rise w-full max-w-lg overflow-hidden my-auto">

        <div className="px-7 py-5 border-b border-[rgba(255,255,255,0.10)] flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-white">Benutzer einladen</h2>
            <p className="text-sm text-[#d6d5d4] mt-0.5">Mehrere Personen zu einer Organisation hinzufügen</p>
          </div>
          <button
            onClick={onClose}
            disabled={sending}
            className="w-7 h-7 flex items-center justify-center text-[#adacab] hover:text-white hover:bg-[#2e2e30] rounded-lg transition-colors ml-4 flex-shrink-0 disabled:opacity-40"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1.5 1.5L9.5 9.5M9.5 1.5L1.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="px-7 py-5 space-y-5 max-h-[calc(100vh-230px)] overflow-y-auto">

          {orgs.length === 0 ? (
            <p className="text-sm text-[#d6d5d4]">Es existiert noch keine Organisation. Bitte zuerst eine Organisation erstellen.</p>
          ) : (
            <form onSubmit={addToQueue} className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-[#d6d5d4] mb-1.5">Organisation</label>
                <select
                  value={orgId}
                  onChange={e => setOrgId(e.target.value)}
                  className={`${inputCls} appearance-none`}
                >
                  {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-[#d6d5d4] mb-1.5">Name</label>
                <input
                  ref={nameRef}
                  type="text"
                  value={name}
                  onChange={e => { setName(e.target.value); if (formError) setFormError(""); }}
                  onKeyDown={e => { if (e.key === "Escape") onClose(); }}
                  placeholder="Vor- und Nachname"
                  className={inputCls}
                  autoFocus
                />
              </div>

              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-[#d6d5d4] mb-1.5">E-Mail</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => { setEmail(e.target.value); if (formError) setFormError(""); }}
                    onKeyDown={e => { if (e.key === "Escape") onClose(); }}
                    placeholder="name@firma.ch"
                    className={inputCls}
                  />
                </div>
                <div className="w-40 flex-shrink-0">
                  <label className="block text-sm font-medium text-[#d6d5d4] mb-1.5">Rolle</label>
                  <select
                    value={role}
                    onChange={e => setRole(e.target.value as InviteRole)}
                    className={`${inputCls} appearance-none`}
                  >
                    {(Object.keys(ROLE_LABELS) as InviteRole[]).map(r => (
                      <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                    ))}
                  </select>
                </div>
              </div>

              {formError && <p className="text-sm text-[#EBA1A1]">{formError}</p>}

              <button
                type="submit"
                className="w-full flex items-center justify-center gap-1.5 border border-dashed border-[rgba(203,191,174,0.55)] text-[#cbbfae] rounded-xl py-2.5 text-sm font-semibold hover:bg-[#cbbfae]/10 active:scale-[0.98] transition-all"
              >
                <svg width="11" height="11" viewBox="0 0 11 11" fill="none" aria-hidden="true">
                  <path d="M5.5 1V10M1 5.5H10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
                Zur Liste hinzufügen
              </button>
            </form>
          )}

          {queue.length > 0 && (
            <div>
              <p className="text-[13px] font-semibold text-[#d6d5d4] uppercase tracking-widest mb-2">
                {queue.length} {queue.length === 1 ? "Einladung" : "Einladungen"}
              </p>
              <div className="space-y-1.5">
                {queue.map(item => (
                  <div key={item.id} className="flex items-center justify-between bg-[#1c1b1b] border border-[rgba(255,255,255,0.10)] rounded-xl px-3.5 py-2.5">
                    <div className="min-w-0">
                      <p className="text-sm text-white truncate">{item.name}</p>
                      <p className="text-[13px] text-[#d6d5d4] truncate">{item.email}</p>
                      <p className="text-[13px] text-[#d6d5d4] truncate">{item.orgName} · {ROLE_LABELS[item.role]}</p>
                      {item.status === "error" && <p className="text-[13px] text-[#EBA1A1] mt-0.5">{item.error}</p>}
                    </div>
                    <div className="flex-shrink-0 flex items-center gap-2.5 ml-3">
                      <StatusIcon status={item.status} />
                      {item.status !== "sending" && item.status !== "sent" && (
                        <button
                          onClick={() => removeFromQueue(item.id)}
                          className="text-[#adacab] hover:text-[#EBA1A1] transition-colors"
                          title="Entfernen"
                        >
                          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                            <path d="M1.5 1.5L8.5 8.5M8.5 1.5L1.5 8.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
                          </svg>
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-7 py-5 border-t border-[rgba(255,255,255,0.10)] flex gap-3">
          <button
            onClick={onClose}
            disabled={sending}
            className="flex-1 border border-[rgba(255,255,255,0.10)] rounded-xl py-2.5 text-sm font-medium text-[#d6d5d4] hover:bg-[#2e2e30] disabled:opacity-40 transition-colors"
          >
            {hasSent && pendingCount === 0 ? "Fertig" : "Abbrechen"}
          </button>
          {pendingCount > 0 && (
            <button
              onClick={sendAll}
              disabled={sending}
              className="flex-1 bg-[linear-gradient(135deg,#cbbfae,#b5a893)] text-[#151414] rounded-xl py-2.5 text-sm font-semibold hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
            >
              {sending ? "Wird gesendet…" : `${pendingCount} ${pendingCount === 1 ? "Einladung" : "Einladungen"} senden →`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
