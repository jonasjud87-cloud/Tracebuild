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
  "bg-[rgba(23,37,64,0.6)] border border-[rgba(133,166,233,0.25)]",
  "placeholder:text-[#7B8299]",
  "focus:outline-none focus:ring-2 focus:ring-[#2862D7]/40 focus:border-[#2862D7]",
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
      <label className="block text-xs font-medium text-[#7B8299] mb-1">{label}</label>
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
          <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[#7B8299] pointer-events-none">
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
    { value: "active",   label: "Aktiv",       dot: "bg-emerald-500", active: "bg-emerald-500/15 border-emerald-500/40 text-emerald-400" },
    { value: "paused",   label: "Pausiert",    dot: "bg-amber-400",   active: "bg-amber-500/15 border-amber-500/40 text-amber-400"       },
    { value: "closed",   label: "Geschlossen", dot: "bg-[#4B5563]",   active: "bg-[rgba(60,63,68,0.5)] border-[rgba(133,166,233,0.3)] text-[#ABAEBB]" },
    { value: "archived", label: "Archiviert",  dot: "bg-[#374151]",   active: "bg-[rgba(60,63,68,0.3)] border-[rgba(60,63,68,0.4)] text-[#7B8299]"   },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm px-4 py-6 overflow-y-auto"
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="bg-[#0E111B] rounded-2xl shadow-2xl w-full max-w-lg border border-[rgba(60,63,68,0.5)] overflow-hidden my-auto">

        <div className="px-7 py-5 border-b border-[rgba(60,63,68,0.4)] flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-white">
              {org ? "Organisation bearbeiten" : "Neue Organisation erstellen"}
            </h2>
            <p className="text-sm text-[#ABAEBB] mt-0.5">
              {org ? "Angaben aktualisieren" : "Neue Organisation zum System hinzufügen"}
            </p>
          </div>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center text-[#7B8299] hover:text-white hover:bg-[#1E2D4A] rounded-lg transition-colors ml-4 flex-shrink-0"
          >
            <svg width="11" height="11" viewBox="0 0 11 11" fill="none">
              <path d="M1.5 1.5L9.5 9.5M9.5 1.5L1.5 9.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="px-7 py-5 space-y-4 max-h-[calc(100vh-220px)] overflow-y-auto">

          <div>
            <label className="block text-sm font-medium text-[#ABAEBB] mb-1.5">
              Organisationsname <span className="text-red-400">*</span>
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
            <label className="block text-sm font-medium text-[#ABAEBB] mb-1.5">Kurzbeschreibung</label>
            <input
              value={description}
              onChange={e => setDescription(e.target.value)}
              className={inputCls}
              placeholder="Kurze Beschreibung der Organisation"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-[#ABAEBB] mb-1.5">Besitzer / Ansprechpartner</label>
              <input
                value={owner}
                onChange={e => setOwner(e.target.value)}
                className={inputCls}
                placeholder="Vollständiger Name"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-[#ABAEBB] mb-1.5">E-Mail</label>
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
              <label className="text-sm font-medium text-[#ABAEBB]">Tarif</label>
              <span className="text-[10px] font-semibold text-[#85A6E9] bg-[#2862D7]/10 px-2 py-0.5 rounded uppercase tracking-wider">
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
            <p className="text-[11px] text-[#7B8299] mt-1">
              Abos werden ausschliesslich durch TraceBuild eingerichtet — keine Selbstverwaltung für Kunden.
            </p>
          </div>

          {!org?.isDefault && (
            <div>
              <label className="block text-sm font-medium text-[#ABAEBB] mb-2">Status</label>
              <div className="grid grid-cols-2 gap-2">
                {statusOptions.map(opt => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setStatus(opt.value)}
                    className={`flex items-center gap-2 py-2 px-3 rounded-xl border text-sm font-medium transition-all ${
                      status === opt.value
                        ? opt.active
                        : "border-[rgba(60,63,68,0.4)] text-[#7B8299] hover:border-[rgba(133,166,233,0.3)] hover:bg-[#1E2D4A]"
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${status === opt.value ? opt.dot : "bg-[rgba(60,63,68,0.5)]"}`} />
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <p className="text-sm font-medium text-[#ABAEBB] mb-2">Limits & Budget</p>
            <div className="grid grid-cols-2 gap-3">
              <NumInput label="Benutzerlimit"      value={userLimit}     onChange={setUserLimit}    />
              <NumInput label="Projektlimit"       value={projectLimit}  onChange={setProjectLimit} />
              <NumInput label="Speicherlimit"      value={storageLimit}  onChange={setStorageLimit} suffix="GB" />
              <NumInput label="Monatliches Budget" value={monthlyBudget} onChange={setMonthlyBudget} suffix="CHF" />
            </div>
          </div>
        </div>

        <div className="px-7 py-5 border-t border-[rgba(60,63,68,0.4)] flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 border border-[rgba(60,63,68,0.4)] rounded-xl py-2.5 text-sm font-medium text-[#ABAEBB] hover:bg-[#1E2D4A] transition-colors"
          >
            Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="flex-1 bg-[#2862D7] text-white rounded-xl py-2.5 text-sm font-semibold hover:bg-[#3470E8] disabled:opacity-40 disabled:cursor-not-allowed active:scale-[0.98] transition-all"
          >
            {org ? "Speichern" : "Erstellen →"}
          </button>
        </div>
      </div>
    </div>
  );
}
