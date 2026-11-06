"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AnnouncementBannerView } from "@/components/announcements/AnnouncementBanner";
import { MESSAGE_MAX, TITLE_MAX, TYPE_OPTIONS, type Announcement, type AnnouncementType } from "./types";
import { isLocalInputChanged, isoToLocalInput, localInputToIso } from "./time";

export interface OrgOption {
  id: string;
  name: string;
}

export interface AnnouncementPayload {
  title: string;
  message: string;
  type: AnnouncementType;
  orgId: string | null;
  startsAt?: string;
  endsAt?: string | null;
  dismissible: boolean;
  active: boolean;
}

interface Props {
  existing: Announcement | null;
  orgs: OrgOption[];
  orgsLoading: boolean;
  saving: boolean;
  serverError: string | null;
  onSubmit: (payload: AnnouncementPayload) => void;
  onClose: () => void;
}

const FIELD = "w-full rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#080D16] px-3 py-2.5 text-sm text-white placeholder:text-[#8E98A6] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0C99A] disabled:opacity-60";
const LABEL = "mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[#8E98A6]";
const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export default function AnnouncementFormDialog({ existing, orgs, orgsLoading, saving, serverError, onSubmit, onClose }: Props) {
  const [title, setTitle] = useState(existing?.title ?? "");
  const [message, setMessage] = useState(existing?.message ?? "");
  const [type, setType] = useState<AnnouncementType>(existing?.type ?? "info");
  const [orgId, setOrgId] = useState<string>(existing?.orgId ?? "");
  const [startNow, setStartNow] = useState(!existing);
  const [startsAt, setStartsAt] = useState(existing ? isoToLocalInput(existing.startsAt) : "");
  const [endsAt, setEndsAt] = useState(existing ? isoToLocalInput(existing.endsAt) : "");
  const [dismissible, setDismissible] = useState(existing?.dismissible ?? true);
  const [active, setActive] = useState(existing?.active ?? true);
  const [submitted, setSubmitted] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(saving);
  const onCloseRef = useRef(onClose);
  savingRef.current = saving;
  onCloseRef.current = onClose;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    titleRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        if (document.querySelector('[role="alertdialog"]')) return;
        if (!savingRef.current) {
          e.stopPropagation();
          onCloseRef.current();
        }
        return;
      }
      if (e.key !== "Tab" || document.querySelector('[role="alertdialog"]')) return;
      const nodes = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
      if (!nodes || nodes.length === 0) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("keydown", onKey, true);
      previous?.focus?.();
    };
  }, []);

  const startDirty = !existing || isLocalInputChanged(startsAt, existing.startsAt);
  const endDirty = !existing || isLocalInputChanged(endsAt, existing.endsAt);

  const errors = useMemo(() => {
    const e: { title?: string; message?: string; startsAt?: string; endsAt?: string } = {};
    if (!title.trim()) e.title = "Bitte einen Titel eingeben.";
    else if (title.trim().length > TITLE_MAX) e.title = `Maximal ${TITLE_MAX} Zeichen.`;
    if (!message.trim()) e.message = "Bitte einen Text eingeben.";
    else if (message.trim().length > MESSAGE_MAX) e.message = `Maximal ${MESSAGE_MAX} Zeichen.`;
    const gapMsg = "Diese Uhrzeit existiert wegen der Zeitumstellung nicht.";
    const startIso = startNow || !startsAt ? null : startDirty ? localInputToIso(startsAt) : existing?.startsAt ?? null;
    if (!startNow && !startsAt) e.startsAt = "Bitte einen Beginn wählen oder «Sofort» aktivieren.";
    else if (!startNow && !startIso) e.startsAt = gapMsg;
    const endIso = !endsAt ? null : endDirty ? localInputToIso(endsAt) : existing?.endsAt ?? null;
    if (endsAt && !endIso) e.endsAt = gapMsg;
    if (endIso && startIso) {
      if (Date.parse(endIso) <= Date.parse(startIso)) e.endsAt = "Das Ende muss nach dem Beginn liegen.";
    }
    return e;
  }, [title, message, startNow, startsAt, endsAt, existing, startDirty, endDirty]);

  const hasErrors = Object.keys(errors).length > 0;

  function handleSubmit(ev: React.FormEvent) {
    ev.preventDefault();
    setSubmitted(true);
    if (hasErrors || saving) return;
    const payload: AnnouncementPayload = {
      title: title.trim(),
      message: message.trim(),
      type,
      orgId: orgId || null,
      dismissible,
      active,
    };
    if (endDirty) payload.endsAt = endsAt ? localInputToIso(endsAt) : null;
    if (!startNow && startDirty) payload.startsAt = localInputToIso(startsAt) ?? undefined;
    onSubmit(payload);
  }

  const previewItem = {
    id: "preview",
    title: title.trim() || "Titel der Ankündigung",
    message: message.trim() || "Hier erscheint der Text der Ankündigung.",
    type,
    dismissible,
  };

  const showErr = (k: keyof typeof errors) => (submitted ? errors[k] : undefined);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto tba-scrim px-4 py-6"
      onClick={e => { if (e.target === e.currentTarget && !saving) onClose(); }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="ann-form-title"
        className="max-h-full w-full max-w-xl overflow-y-auto tba-glass tba-glass--modal rounded-2xl p-6 "
      >
        <h2 id="ann-form-title" className="mb-5 text-lg font-bold text-white">
          {existing ? "Ankündigung bearbeiten" : "Neue Ankündigung"}
        </h2>

        <form onSubmit={handleSubmit} noValidate className="space-y-4">
          <div>
            <label htmlFor="ann-title" className={LABEL}>Titel</label>
            <input
              id="ann-title"
              ref={titleRef}
              value={title}
              onChange={e => setTitle(e.target.value)}
              maxLength={TITLE_MAX + 40}
              disabled={saving}
              aria-invalid={!!showErr("title")}
              aria-describedby="ann-title-help"
              className={FIELD}
            />
            <div id="ann-title-help" className="mt-1 flex justify-between text-xs">
              <span className="text-[#EBA1A1]">{showErr("title")}</span>
              <span className={title.length > TITLE_MAX ? "text-[#EBA1A1]" : "text-[#8E98A6]"}>{title.length}/{TITLE_MAX}</span>
            </div>
          </div>

          <div>
            <label htmlFor="ann-message" className={LABEL}>Text</label>
            <textarea
              id="ann-message"
              value={message}
              onChange={e => setMessage(e.target.value)}
              rows={4}
              disabled={saving}
              aria-invalid={!!showErr("message")}
              aria-describedby="ann-message-help"
              className={`${FIELD} resize-y`}
            />
            <div id="ann-message-help" className="mt-1 flex justify-between text-xs">
              <span className="text-[#EBA1A1]">{showErr("message")}</span>
              <span className={message.length > MESSAGE_MAX ? "text-[#EBA1A1]" : "text-[#8E98A6]"}>{message.length}/{MESSAGE_MAX}</span>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ann-type" className={LABEL}>Typ</label>
              <select id="ann-type" value={type} onChange={e => setType(e.target.value as AnnouncementType)} disabled={saving} className={FIELD}>
                {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="ann-org" className={LABEL}>Geltungsbereich</label>
              <select id="ann-org" value={orgId} onChange={e => setOrgId(e.target.value)} disabled={saving} className={FIELD}>
                <option value="">Alle Nutzer</option>
                {existing?.orgId && !orgs.some(o => o.id === existing.orgId) && (
                  <option value={existing.orgId}>{existing.orgName ?? "Organisation"}</option>
                )}
                {orgs.map(o => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
              {orgsLoading && <p className="mt-1 text-xs text-[#8E98A6]">Organisationen werden geladen …</p>}
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="ann-start" className={LABEL}>Beginn (Zürich)</label>
              <input
                id="ann-start"
                type="datetime-local"
                value={startNow ? "" : startsAt}
                onChange={e => setStartsAt(e.target.value)}
                disabled={saving || startNow}
                aria-invalid={!!showErr("startsAt")}
                className={FIELD}
              />
              {!existing && (
                <label className="mt-2 flex items-center gap-2 text-sm text-[#A7AFBA]">
                  <input
                    type="checkbox"
                    checked={startNow}
                    disabled={saving}
                    onChange={e => {
                      setStartNow(e.target.checked);
                      if (!e.target.checked && !startsAt) setStartsAt(isoToLocalInput(new Date().toISOString()));
                    }}
                    className="h-4 w-4 accent-[#F0C99A]"
                  />
                  Sofort
                </label>
              )}
              {showErr("startsAt") && <p className="mt-1 text-xs text-[#EBA1A1]">{showErr("startsAt")}</p>}
            </div>
            <div>
              <label htmlFor="ann-end" className={LABEL}>Ende (optional, Zürich)</label>
              <input
                id="ann-end"
                type="datetime-local"
                value={endsAt}
                onChange={e => setEndsAt(e.target.value)}
                disabled={saving}
                aria-invalid={!!showErr("endsAt")}
                className={FIELD}
              />
              {showErr("endsAt") && <p className="mt-1 text-xs text-[#EBA1A1]">{showErr("endsAt")}</p>}
            </div>
          </div>

          <div className="flex flex-wrap gap-x-6 gap-y-2">
            <label className="flex items-center gap-2 text-sm text-[#A7AFBA]">
              <input type="checkbox" checked={dismissible} disabled={saving} onChange={e => setDismissible(e.target.checked)} className="h-4 w-4 accent-[#F0C99A]" />
              Nutzer dürfen ausblenden
            </label>
            <label className="flex items-center gap-2 text-sm text-[#A7AFBA]">
              <input type="checkbox" checked={active} disabled={saving} onChange={e => setActive(e.target.checked)} className="h-4 w-4 accent-[#F0C99A]" />
              Aktiv
            </label>
          </div>

          <div>
            <p className={LABEL}>Vorschau</p>
            <div className="pointer-events-none select-none" aria-hidden="false">
              <AnnouncementBannerView items={[previewItem]} />
            </div>
          </div>

          {serverError && (
            <p role="alert" className="rounded-xl border border-[#D87979]/30 bg-[#D87979]/30 px-3 py-2.5 text-sm text-[#EBA1A1]">{serverError}</p>
          )}

          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="flex-1 rounded-xl border border-[rgba(255,255,255,0.08)] py-2.5 text-sm font-medium text-[#A7AFBA] hover:bg-[#223247] disabled:opacity-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0C99A]"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 rounded-xl bg-[linear-gradient(135deg,#F0C99A,#B07D3E)] py-2.5 text-sm font-semibold text-[#07142B] hover:bg-[#C79B63] disabled:opacity-60 focus:outline-none focus-visible:ring-2 focus-visible:ring-[#F0C99A]"
            >
              {saving ? "Speichern …" : existing ? "Änderungen speichern" : "Ankündigung erstellen"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
