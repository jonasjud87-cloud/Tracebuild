"use client";

import { useState, useEffect } from "react";
import type { Organization, PlanTier, OrgStatus } from "./types";

export interface OrgFormData {
  name: string;
  description: string;
  planTier: PlanTier;
  status: OrgStatus;
  owner: string;
  ownerEmail: string;
  userLimit: number | null;
  projectLimit: number | null;
  storageLimit: number | null;
  monthlyBudget: number | null;
}

interface Props {
  org: Organization | null;
  onSave: (data: OrgFormData) => void;
  onClose: () => void;
}

const inputCls = [
  "w-full rounded-xl px-3.5 py-2.5 text-sm text-white",
  "bg-[rgba(28,27,27,0.6)] border border-[rgba(203,191,174,0.55)]",
  "placeholder:text-[#adacab]",
  "focus:outline-none focus:ring-2 focus:ring-[#cbbfae]/40 focus:border-[#cbbfae]",
  "transition-colors",
].join(" ");

function NumInput({
  label, value, onChange, suffix,
}: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  suffix?: string;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-[#adacab] mb-1">{label}</label>
      <div className="relative">
        <input
          type="number"
          min={0}
          value={value ?? ""}
          onChange={e => onChange(e.target.value === "" ? null : Number(e.target.value))}
          className={inputCls}
          placeholder="—"
        />
        {suffix && (
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-[#adacab] pointer-events-none">
            {suffix}
          </span>
        )}
      </div>
    </div>
  );
}

export default function OrgModal({ org, onSave, onClose }: Props) {
  const [name, setName]               = useState(org?.name ?? "");
  const [description, setDescription] = useState(org?.description ?? "");
  const [planTier, setPlanTier]       = useState<PlanTier>(org?.planTier ?? "starter");
  const [status, setStatus]           = useState<OrgStatus>(org?.status ?? "active");
  const [owner, setOwner]             = useState(org?.owner ?? "");
  const [ownerEmail, setOwnerEmail]   = useState(org?.ownerEmail ?? "");
  const [userLimit, setUserLimit]     = useState<number | null>(null);
  const [projectLimit, setProjectLimit] = useState<number | null>(null);
  const [storageLimit, setStorageLimit] = useState<number | null>(null);
  const [monthlyBudget, setMonthlyBudget] = useState<number | null>(org?.monthlyBudget ?? null);

  useEffect(() => {
    setName(org?.name ?? "");
    setDescription(org?.description ?? "");
    setPlanTier(org?.planTier ?? "starter");
    setStatus(org?.status ?? "active");
    setOwner(org?.owner ?? "");
    setOwnerEmail(org?.ownerEmail ?? "");
    setUserLimit(org?.userLimit    ?? null);
    setProjectLimit(org?.projectLimit ?? null);
    setStorageLimit(org?.storageLimitGb ?? null);
    setMonthlyBudget(org?.monthlyBudget ?? null);
  }, [org]);

  function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    onSave({
      name: trimmed,
      description: description.trim(),
      planTier,
      status,
      owner: owner.trim(),
      ownerEmail: ownerEmail.trim(),
      userLimit,
      projectLimit,
      storageLimit,
      monthlyBudget,
    });
  }

  const statusOptions: { value: OrgStatus; label: string; dot: string; active: string }[] = [
    { value: "active",   label: "Aktiv",       dot: "bg-[#65A88A]", active: "bg-[#65A88A]/15 border-[#65A88A]/40 text-[#8FD0B1]" },
    { value: "paused",   label: "Pausiert",    dot: "bg-[#D6A45F]",   active: "bg-[#D6A45F]/15 border-[#D6A45F]/40 text-[#D6A45F]"       },
    { value: "closed",   label: "Geschlossen", dot: "bg-[#8a8a8a]",   active: "bg-[rgba(255,255,255,0.10)] border-[rgba(203,191,174,0.3)] text-[#d6d5d4]" },
    { value: "archived", label: "Archiviert",  dot: "bg-[#5f5e5e]",   active: "bg-[rgba(255,255,255,0.10)] border-[rgba(255,255,255,0.10)] text-[#adacab]"   },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center tba-scrim tbb-fade px-4 py-6 overflow-y-auto"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="tba-glass tba-glass--modal rounded-2xl tbb-rise w-full max-w-lg overflow-hidden my-auto">

        <div className="px-7 py-5 border-b border-[rgba(255,255,255,0.10)] flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-white">
              {org ? "Organisation bearbeiten" : "Neue Organisation erstellen"}
            </h2>
            <p className="text-sm text-[#d6d5d4] mt-0.5">
              {org ? "Angaben aktualisieren" : "Neue Organisation zum System hinzufügen"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-[#adacab] hover:text-white hover:bg-[#2e2e30] rounded-lg transition-colors ml-4 flex-shrink-0"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1.5 1.5L9.5 9.5M9.5 1.5L1.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="px-7 py-5 space-y-4 max-h-[calc(100vh-220px)] overflow-y-auto">

          <div>
            <label className="block text-sm font-medium text-[#d6d5d4] mb-1.5">
              Organisationsname <span className="text-[#EBA1A1]">*</span>
            </label>
            <input
              value={name}
              onChange={e => setName(e.target.value)}
              onKeyDown={e => { if (e.key === "Escape") onClose(); }}
              className={inputCls}
              placeholder="z.B. Müller Architekten AG"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-[#d6d5d4] mb-1.5">Kurzbeschreibung</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              className={inputCls}
              placeholder="Kurze Beschreibung der Organisation"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-[#d6d5d4] mb-1.5">Besitzer / Ansprechpartner</label>
              <input
                value={owner}
                onChange={e => setOwner(e.target.value)}
                className={inputCls}
                placeholder="Vollständiger Name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#d6d5d4] mb-1.5">E-Mail</label>
              <input
                type="email"
                value={ownerEmail}
                onChange={e => setOwnerEmail(e.target.value)}
                className={inputCls}
                placeholder="name@beispiel.ch"
              />
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-sm font-medium text-[#d6d5d4]">Tarif</label>
              <span className="text-[13px] font-semibold text-[#cbbfae] bg-[#cbbfae]/10 px-2 py-0.5 rounded uppercase tracking-wider">
                Nur TraceBuild-Intern
              </span>
            </div>
            <select
              value={planTier}
              onChange={e => setPlanTier(e.target.value as PlanTier)}
              className={`${inputCls} appearance-none`}
            >
              <option value="starter">Starter</option>
              <option value="business">Business</option>
              <option value="enterprise">Enterprise</option>
            </select>
            <p className="text-[13px] text-[#d6d5d4] mt-1">
              Abos werden ausschliesslich durch TraceBuild eingerichtet — keine Selbstverwaltung für Kunden.
            </p>
          </div>

          {!org?.isDefault && (
            <div>
              <label className="block text-sm font-medium text-[#d6d5d4] mb-2">Status</label>
              <div className="grid grid-cols-2 gap-2">
                {statusOptions.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatus(opt.value)}
                    className={`flex items-center gap-2 py-2 px-3 rounded-xl border text-sm font-medium transition-all ${
                      status === opt.value
                        ? opt.active
                        : "border-[rgba(255,255,255,0.10)] text-[#adacab] hover:border-[rgba(203,191,174,0.3)] hover:bg-[#2e2e30]"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${status === opt.value ? opt.dot : "bg-[rgba(255,255,255,0.10)]"}`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-[#d6d5d4] mb-2">Limits & Budget</p>
            <div className="grid grid-cols-2 gap-3">
              <NumInput label="Benutzerlimit"      value={userLimit}     onChange={setUserLimit}    />
              <NumInput label="Projektlimit"       value={projectLimit}  onChange={setProjectLimit} />
              <NumInput label="Speicherlimit"      value={storageLimit}  onChange={setStorageLimit} suffix="GB" />
              <NumInput label="Monatliches Budget" value={monthlyBudget} onChange={setMonthlyBudget} suffix="CHF" />
            </div>
          </div>
        </div>

        <div className="px-7 py-5 border-t border-[rgba(255,255,255,0.10)] flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border border-[rgba(255,255,255,0.10)] rounded-xl py-2.5 text-sm font-medium text-[#d6d5d4] hover:bg-[#2e2e30] transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="flex-1 bg-[linear-gradient(135deg,#cbbfae,#b5a893)] text-[#151414] rounded-xl py-2.5 text-sm font-semibold hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
          >
            {org ? "Speichern" : "Erstellen →"}
          </button>
        </div>
      </div>
    </div>
  );
}
