"use client";

import { useRef, useState } from "react";
import { api } from "@/lib/api";
import { formatDate } from "@/components/geoportal-logic";
import { priorityLabel, scopeLabel, type NormPriority, type ScopeMode } from "@/lib/company-norms";
import type { FileEntry } from "@/lib/standards-model";
import ScopeFields, { scopeError, type ProjectOption, type ScopeValue } from "./ScopeFields";
import s from "./standards.module.css";

interface Props {
  entry: FileEntry;
  projects: ProjectOption[];
  canApprove: boolean;
  onChanged: () => Promise<void>;
}

function messageOf(e: unknown): string {
  return e instanceof Error ? e.message : "Aktion fehlgeschlagen.";
}

export default function CompanyBlock({ entry, projects, canApprove, onChanged }: Props) {
  const info = entry.company;
  const id = entry.ids[0];
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [scope, setScope] = useState<ScopeValue | null>(null);

  if (!info) return null;
  const projectNames: Record<string, string> = {};
  projects.forEach((p) => {
    projectNames[p.id] = p.name;
  });
  const draft = info.status === "draft";

  async function run(task: () => Promise<string>) {
    setBusy(true);
    setMessage(null);
    try {
      const text = await task();
      await onChanged();
      setMessage({ kind: "ok", text });
    } catch (e) {
      setMessage({ kind: "err", text: messageOf(e) });
    } finally {
      setBusy(false);
    }
  }

  function approve() {
    const previous = info?.supersedesId ? " Die bisherige Version wird dabei archiviert." : "";
    if (!confirm(`Diese Unternehmensnorm freigeben? Ab dann wird sie bei jeder passenden Prüfung berücksichtigt.${previous}`)) return;
    void run(async () => {
      await api.post(`/standards/${id}/approve`, {});
      return "Freigegeben. Die Norm gilt jetzt für passende Projekte.";
    });
  }

  function startEdit() {
    if (!info) return;
    setScope({
      priority: (info.priority === "binding" ? "binding" : "advisory") as NormPriority,
      mode: (["all", "cantons", "projects"].includes(info.scopeMode) ? info.scopeMode : "all") as ScopeMode,
      cantons: info.scopeCantons,
      projectIds: info.scopeProjectIds,
    });
    setEditing(true);
    setMessage(null);
  }

  function saveEdit() {
    if (!scope) return;
    const problem = scopeError(scope);
    if (problem) {
      setMessage({ kind: "err", text: problem });
      return;
    }
    void run(async () => {
      await api.patch(`/standards/${id}/company`, {
        priority: scope.priority,
        scope: { mode: scope.mode, cantons: scope.cantons, projectIds: scope.projectIds },
      });
      setEditing(false);
      return "Einstellungen gespeichert.";
    });
  }

  function uploadVersion(file: File | undefined) {
    if (!file) return;
    void run(async () => {
      const form = new FormData();
      form.append("file", file);
      await api.postForm(`/standards/${id}/version`, form);
      if (fileRef.current) fileRef.current.value = "";
      return "Neue Version als Entwurf gespeichert. Sie gilt erst nach der Freigabe.";
    });
  }

  const approvedOn = formatDate(info.approvedAt);

  return (
    <div className={`${s.company} ${draft ? s.companyDraft : ""}`}>
      <p className={s.hintTitle}>
        {info.archived ? "Frühere Version, archiviert" : draft ? "Entwurf, wird noch nicht geprüft" : "Freigegeben, wird bei Prüfungen berücksichtigt"}
      </p>
      <p className={s.companyMeta}>
        Version {info.versionNo} · {priorityLabel(info.priority)} · Gilt für: {scopeLabel({ scope_mode: info.scopeMode, scope_cantons: info.scopeCantons, scope_project_ids: info.scopeProjectIds }, projectNames)}
        {!draft && approvedOn ? ` · Freigegeben am ${approvedOn}${info.approvedByEmail ? ` von ${info.approvedByEmail}` : ""}` : ""}
      </p>
      {draft && !canApprove && <p className={s.companyMeta}>Eine verantwortliche Person (Organisations-Admin) muss diese Norm freigeben.</p>}

      {!info.archived && (
        <div className={s.companyActions}>
          {draft && canApprove && (
            <button type="button" disabled={busy} onClick={approve} className={s.btnSand}>
              {busy ? "Wird gespeichert…" : "Freigeben"}
            </button>
          )}
          {!draft && (
            <>
              <input ref={fileRef} type="file" accept=".pdf,.txt" className={s.sr} tabIndex={-1} aria-hidden="true" onChange={(e) => uploadVersion(e.target.files?.[0])} />
              <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className={s.btnGhost}>
                Neue Version hochladen
              </button>
            </>
          )}
          {canApprove && (
            <button type="button" disabled={busy} onClick={() => (editing ? setEditing(false) : startEdit())} className={s.btnGhost} aria-expanded={editing}>
              {editing ? "Einstellungen schliessen" : "Einstellungen ändern"}
            </button>
          )}
        </div>
      )}

      {editing && scope && (
        <div className={`${s.companyForm} ${s.fields}`}>
          <ScopeFields value={scope} onChange={setScope} projects={projects} disabled={busy} />
          <div className={s.fieldFull}>
            <button type="button" disabled={busy} onClick={saveEdit} className={s.btnSand}>
              {busy ? "Wird gespeichert…" : "Speichern"}
            </button>
          </div>
        </div>
      )}

      {message && (
        <p role={message.kind === "err" ? "alert" : "status"} className={`${s.notice} ${message.kind === "err" ? s.noticeErr : s.noticeOk}`} style={{ marginTop: 10 }}>
          {message.text}
        </p>
      )}

      {info.history.length > 0 && (
        <details style={{ marginTop: 10 }}>
          <summary className={s.hintTitle} style={{ cursor: "pointer" }}>
            Frühere Versionen ({info.history.length})
          </summary>
          <ul className={s.versionList}>
            {info.history.map((h) => (
              <li key={h.id}>
                Version {h.versionNo}
                {formatDate(h.approvedAt) ? `, freigegeben am ${formatDate(h.approvedAt)}` : ""}
                {h.approvedByEmail ? ` von ${h.approvedByEmail}` : ""}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
